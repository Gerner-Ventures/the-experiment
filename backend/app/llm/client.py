from __future__ import annotations

import json
from typing import Any, cast

import litellm
from pydantic import BaseModel, ValidationError

import structlog

from app.core.config import get_settings
from app.core import posthog as ph
from app.core.langfuse import get_trace_context
from app.llm.config import get_default_model_configs
from app.llm.models import LLMModelConfig, LLMRequest, LLMResult, LLMUsage, UsageRecord
from app.llm.tracker import UsageTracker

log = structlog.get_logger(__name__)


class LLMClient:
    def __init__(self, tracker: UsageTracker | None = None) -> None:
        self.settings = get_settings()
        self.model_configs = get_default_model_configs()
        self.tracker = tracker or UsageTracker()
        self._register_langfuse_callbacks()
        litellm.enable_json_schema_validation = True
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
        metadata = self._build_metadata(request)
        log.debug(
            "langfuse_context",
            trace_id=metadata.get("trace_id"),
            parent_observation_id=metadata.get("parent_observation_id"),
            generation_name=metadata.get("generation_name"),
            has_context=bool(get_trace_context()),
        )

        max_attempts = 2 if request.response_format is not None else 1
        result: LLMResult | None = None

        for attempt in range(max_attempts):
            response = await self.router.acompletion(
                model=request.model_override or model_config.primary_model,
                messages=cast(Any, messages),
                response_format=request.response_format,
                temperature=request.temperature
                if request.temperature is not None
                else model_config.temperature,
                max_tokens=request.max_tokens,
                timeout=model_config.timeout_seconds,
                metadata=metadata,
            )
            result = self._build_result(response)
            finish_reason = (
                getattr(response.choices[0], "finish_reason", None) if response.choices else None
            )

            if request.response_format is not None:
                parsed = self._try_parse(result.content, request.response_format)
                if parsed is None:
                    is_final_attempt = attempt == max_attempts - 1
                    log.warning(
                        "llm_structured_parse_failed",
                        role=request.role,
                        model=result.model,
                        experiment_id=request.metadata.get("experiment_id"),
                        content_preview=result.content[:300],
                        finish_reason=finish_reason,
                        completion_tokens=result.usage.completion_tokens,
                        max_tokens_requested=request.max_tokens,
                        attempt=attempt + 1,
                        max_attempts=max_attempts,
                    )
                    self._track_usage(request, result)
                    if not is_final_attempt:
                        # Corrective retry: append the failed response and error
                        # context so the model can self-correct instead of blind replay
                        messages.append({"role": "assistant", "content": result.content})
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    "Your JSON response could not be parsed. "
                                    "Please return valid JSON matching the expected schema."
                                ),
                            }
                        )
                        continue
                    ph.capture(
                        "llm_parse_failure",
                        {
                            "role": request.role,
                            "model": result.model,
                            "experiment_id": request.metadata.get("experiment_id"),
                            "finish_reason": finish_reason,
                            "completion_tokens": result.usage.completion_tokens,
                            "max_tokens_requested": request.max_tokens,
                        },
                    )
                    raise ValueError(
                        f"model response did not match expected structured format. "
                        f"Raw content: {result.content[:300]}"
                    )
                else:
                    result.parsed = parsed

            self._track_usage(request, result)
            break

        # unreachable: loop always returns via break or raises
        assert result is not None
        return result

    def _build_metadata(self, request: LLMRequest) -> dict[str, Any]:
        """Build enriched metadata for Langfuse from an LLMRequest.

        Note: request.metadata may contain a "tags" key — litellm's Langfuse
        callback reads metadata["tags"] and forwards them as generation tags.
        """
        return {
            **request.metadata,
            **get_trace_context(),
            "generation_name": request.generation_name or request.role,
            # Convert "" to None so Langfuse doesn't create a phantom empty-string session
            "session_id": request.metadata.get("experiment_id") or None,
            "trace_user_id": request.metadata.get("agent_name", request.role),
        }

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
        model_name = getattr(response, "model", "")
        provider = getattr(response, "provider", None)
        if not provider and "/" in model_name:
            provider = model_name.split("/", 1)[0]

        return LLMResult(
            model=model_name,
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

    @staticmethod
    def _try_parse(
        content: str,
        response_format: dict[str, Any] | type[BaseModel],
    ) -> dict[str, Any] | None:
        if isinstance(response_format, type) and issubclass(response_format, BaseModel):
            try:
                return response_format.model_validate_json(content).model_dump(mode="json")
            except (ValidationError, ValueError):
                return None

        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            return None
        return payload if isinstance(payload, dict) else None

    def _track_usage(self, request: LLMRequest, result: LLMResult) -> None:
        metadata = request.metadata
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
                raw_response=result.raw_response,
                usage=result.usage,
            )
        )


def _string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None
