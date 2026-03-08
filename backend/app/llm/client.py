from __future__ import annotations

import json
from typing import Any, cast

import litellm
from pydantic import BaseModel, ValidationError

import structlog

from app.core.config import get_settings
from app.core import posthog as ph
from app.core.langfuse import get_trace_context, log_event
from app.llm.config import get_default_model_configs
from app.llm.models import LLMModelConfig, LLMRequest, LLMResult, LLMUsage, RepairAttempt
from app.llm.tracker import UsageTracker

log = structlog.get_logger(__name__)


class LLMClient:
    def __init__(self, tracker: UsageTracker | None = None) -> None:
        self.settings = get_settings()
        self.model_configs = get_default_model_configs()
        self.tracker = tracker or UsageTracker()
        self._register_langfuse_callbacks()
        router_cls = cast(Any, getattr(litellm, "Router"))
        self.router = router_cls(
            model_list=self._build_model_list(),
            fallbacks=self._build_fallbacks(),
            num_retries=self.settings.llm_max_retries,
            max_fallbacks=self.settings.llm_max_fallbacks,
            timeout=self.settings.llm_timeout_seconds,
            set_verbose=False,
        )

    def _register_langfuse_callbacks(self) -> None:
        if not self.settings.langfuse_enabled:
            return
        if "langfuse" not in litellm.success_callback:
            litellm.success_callback.append("langfuse")
        if "langfuse" not in litellm.failure_callback:
            litellm.failure_callback.append("langfuse")

    async def generate_structured(self, request: LLMRequest) -> LLMResult:
        model_config = self._resolve_model_config(request)
        messages = list(request.messages)
        api_response_format: dict[str, Any] | type[BaseModel] | None = request.response_format

        # For Pydantic models, inject the JSON schema into the system prompt
        # so Anthropic models know what structure to return
        if isinstance(request.response_format, type) and issubclass(
            request.response_format, BaseModel
        ):
            schema = request.response_format.model_json_schema()
            schema_instruction = (
                f"\n\nYou MUST respond with valid JSON matching this schema:\n"
                f"```json\n{json.dumps(schema, indent=2)}\n```\n"
                f"Return ONLY the JSON object, no other text."
            )
            if messages and messages[0].get("role") == "system":
                messages[0] = {
                    **messages[0],
                    "content": messages[0]["content"] + schema_instruction,
                }
            else:
                messages.insert(0, {"role": "system", "content": schema_instruction.strip()})
            api_response_format = {"type": "json_object"}

        metadata = self._build_metadata(request)
        log.debug(
            "langfuse_context",
            trace_id=metadata.get("trace_id"),
            parent_observation_id=metadata.get("parent_observation_id"),
            generation_name=metadata.get("generation_name"),
            has_context=bool(get_trace_context()),
        )
        response = await self.router.acompletion(
            model=request.model_override or model_config.primary_model,
            messages=cast(Any, messages),
            response_format=api_response_format,
            temperature=request.temperature
            if request.temperature is not None
            else model_config.temperature,
            timeout=model_config.timeout_seconds,
            metadata=metadata,
        )
        result = self._build_result(response)

        if request.response_format is not None:
            parsed = self._parse_structured_content(result.content, request.response_format)
            if parsed is None:
                log_event(
                    name="json_repair_attempted",
                    metadata={"role": request.role, "original_content": result.content[:500]},
                )
                repaired = await self._repair_json(request, result)
                if repaired is not None:
                    result = repaired
                else:
                    log.error(
                        "llm_structured_parse_failed",
                        role=request.role,
                        model=result.model,
                        experiment_id=request.metadata.get("experiment_id"),
                    )
                    ph.capture(
                        "llm_parse_failure",
                        {
                            "role": request.role,
                            "model": result.model,
                            "experiment_id": request.metadata.get("experiment_id"),
                        },
                    )
                    raise ValueError(
                        f"model response did not match expected structured format. "
                        f"Raw content: {result.content[:300]}"
                    )
            else:
                result.parsed = parsed

        self._track_usage(request, result)
        return result

    def _build_metadata(
        self,
        request: LLMRequest,
        *,
        generation_name_override: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build enriched metadata for Langfuse from an LLMRequest.

        Note: request.metadata may contain a "tags" key — litellm's Langfuse
        callback reads metadata["tags"] and forwards them as generation tags.
        """
        metadata = {
            **request.metadata,
            **get_trace_context(),
            "generation_name": generation_name_override or request.generation_name or request.role,
            # Convert "" to None so Langfuse doesn't create a phantom empty-string session
            "session_id": request.metadata.get("experiment_id") or None,
            "trace_user_id": request.metadata.get("agent_name", request.role),
        }
        if extra:
            metadata.update(extra)
        return metadata

    def _resolve_model_config(self, request: LLMRequest) -> LLMModelConfig:
        return self.model_configs[request.role]

    def _build_model_list(self) -> list[dict[str, Any]]:
        unique_models = {
            model
            for config in self.model_configs.values()
            for model in [config.primary_model, *config.fallback_models]
        }
        return [
            {"model_name": model, "litellm_params": {"model": model}}
            for model in sorted(unique_models)
        ]

    def _build_fallbacks(self) -> list[dict[str, list[str]]]:
        fallbacks: list[dict[str, list[str]]] = []
        for config in self.model_configs.values():
            if config.fallback_models:
                fallbacks.append({config.primary_model: config.fallback_models})
        return fallbacks

    def _build_result(self, response: Any) -> LLMResult:
        message = response.choices[0].message
        content = (
            message.content if isinstance(message.content, str) else json.dumps(message.content)
        )
        usage = getattr(response, "usage", None)
        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        total_tokens = int(getattr(usage, "total_tokens", prompt_tokens + completion_tokens) or 0)
        cost = self._calculate_cost(response)
        provider = getattr(response, "provider", None) or self._infer_provider(
            getattr(response, "model", "")
        )

        return LLMResult(
            model=getattr(response, "model", ""),
            provider=provider,
            content=content,
            usage=LLMUsage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                cost_usd=cost,
            ),
            raw_response=response.model_dump() if hasattr(response, "model_dump") else {},
        )

    def _calculate_cost(self, response: Any) -> float:
        try:
            cost = litellm.cost_calculator.completion_cost(completion_response=response)
            return round(float(cost), 6)
        except Exception:
            return 0.0

    def _parse_structured_content(
        self,
        content: str,
        response_format: dict[str, Any] | type[BaseModel],
    ) -> dict[str, Any] | None:
        text = content.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            lines = text.split("\n")
            # Remove first line (```json or ```) and last line (```)
            if lines[-1].strip() == "```":
                lines = lines[1:-1]
            else:
                lines = lines[1:]
            text = "\n".join(lines).strip()
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return None

        if isinstance(response_format, type) and issubclass(response_format, BaseModel):
            try:
                return response_format.model_validate(payload).model_dump(mode="json")
            except ValidationError:
                return None

        return payload if isinstance(payload, dict) else None

    async def _repair_json(self, request: LLMRequest, result: LLMResult) -> LLMResult | None:
        repair_prompt = RepairAttempt(
            original_text=result.content,
            error="Response was not valid structured JSON for the requested schema.",
        )
        repair_messages = [
            {
                "role": "system",
                "content": "Repair the user's text into valid JSON matching the requested schema. Return JSON only.",
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "schema": request.response_format
                        if isinstance(request.response_format, dict)
                        else request.response_format.model_json_schema()
                        if isinstance(request.response_format, type)
                        and issubclass(request.response_format, BaseModel)
                        else "unknown",
                        "failed_response": repair_prompt.original_text,
                        "error": repair_prompt.error,
                    }
                ),
            },
        ]
        model_config = self._resolve_model_config(request)
        repair_response = await self.router.acompletion(
            model=request.model_override or model_config.primary_model,
            messages=cast(Any, repair_messages),
            temperature=0,
            timeout=model_config.timeout_seconds,
            metadata=self._build_metadata(
                request,
                generation_name_override=f"{request.generation_name or request.role}:repair",
                extra={"repair_pass": True},
            ),
        )
        repaired_result = self._build_result(repair_response)
        response_format = request.response_format
        if response_format is None:
            return None
        parsed = self._parse_structured_content(repaired_result.content, response_format)
        if parsed is None:
            return None
        repaired_result.parsed = parsed
        repaired_result.repaired = True
        return repaired_result

    def _track_usage(self, request: LLMRequest, result: LLMResult) -> None:
        metadata = request.metadata
        from app.llm.models import UsageRecord

        self.tracker.record(
            UsageRecord(
                role=request.role,
                model=result.model,
                provider=result.provider,
                experiment_id=_string_or_none(metadata.get("experiment_id")),
                round_number=_int_or_none(metadata.get("round_number")),
                agent_id=_string_or_none(metadata.get("agent_id")),
                prompt_messages=[dict(message) for message in request.messages],
                response_content=result.content,
                parsed_response=result.parsed,
                repaired=result.repaired,
                raw_response=result.raw_response,
                usage=result.usage,
            )
        )

    def _infer_provider(self, model: str) -> str | None:
        if "/" in model:
            return model.split("/", 1)[0]
        return None


def _string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None
