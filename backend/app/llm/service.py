from __future__ import annotations

from pydantic import BaseModel

from app.llm.client import LLMClient
from app.llm.models import LLMRequest, LLMResult, UsageSummary


class LLMService:
    def __init__(self, client: LLMClient | None = None) -> None:
        self.client = client or LLMClient()

    async def generate_gm_plan(
        self,
        *,
        messages: list[dict[str, str]],
        response_format: dict[str, object] | type[BaseModel],
        metadata: dict[str, object] | None = None,
        model_override: str | None = None,
    ) -> LLMResult:
        return await self.client.generate_structured(
            LLMRequest(
                role="gm",
                messages=messages,
                response_format=response_format,
                metadata=metadata or {},
                model_override=model_override,
            )
        )

    async def generate_agent_decision(
        self,
        *,
        messages: list[dict[str, str]],
        response_format: dict[str, object] | type[BaseModel],
        metadata: dict[str, object] | None = None,
        model_override: str | None = None,
    ) -> LLMResult:
        return await self.client.generate_structured(
            LLMRequest(
                role="agent",
                messages=messages,
                response_format=response_format,
                metadata=metadata or {},
                model_override=model_override,
            )
        )

    def summarize_usage(
        self,
        *,
        experiment_id: str | None = None,
        round_number: int | None = None,
        agent_id: str | None = None,
    ) -> UsageSummary:
        return self.client.tracker.summarize(
            experiment_id=experiment_id,
            round_number=round_number,
            agent_id=agent_id,
        )
