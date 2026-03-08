from __future__ import annotations

import json
from typing import TYPE_CHECKING

from pydantic import BaseModel

from app.llm.client import LLMClient
from app.llm.models import (
    LLMRequest,
    LLMResult,
    MemoryConsolidationDecision,
    MemoryPromotionDecision,
    RelationshipConsolidationDecision,
    UsageSummary,
)

if TYPE_CHECKING:
    from app.agents.models import KeyMemory, MemoryEvent, RelationshipMemory, SecretGoal


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
                generation_name=(metadata or {}).get("generation_name"),
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
                generation_name=(metadata or {}).get("generation_name"),
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

    async def classify_memory_event(
        self,
        *,
        event: MemoryEvent,
        goal: SecretGoal | None,
        suspicion_level: float,
        recent_key_memories: list[KeyMemory],
        experiment_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
    ) -> MemoryPromotionDecision:
        result = await self.client.generate_structured(
            LLMRequest(
                role="memory",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You classify whether an agent should keep an observation as a key memory. "
                            "Return JSON only. Promote only when the event is likely to shape the agent's "
                            "future reasoning, relationships, identity, or long-term goals."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "event": event.model_dump(mode="json"),
                                "goal": goal.model_dump(mode="json") if goal is not None else None,
                                "suspicion_level": suspicion_level,
                                "recent_key_memories": [
                                    memory.model_dump(mode="json")
                                    for memory in recent_key_memories[-3:]
                                ],
                            }
                        ),
                    },
                ],
                response_format=MemoryPromotionDecision,
                metadata={
                    "memory_classifier": True,
                    "round_number": event.round_number,
                    "experiment_id": experiment_id or "",
                    "agent_id": agent_id or "",
                    "agent_name": agent_name or "",
                },
                generation_name=f"memory:classify:{agent_name}" if agent_name else "memory:classify",
            )
        )
        return MemoryPromotionDecision.model_validate(
            _require_parsed_result(result, operation="memory classification")
        )

    async def consolidate_memory_events(
        self,
        *,
        events: list[MemoryEvent],
        goal: SecretGoal | None,
        suspicion_level: float,
        recent_key_memories: list[KeyMemory],
        experiment_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
    ) -> MemoryConsolidationDecision:
        result = await self.client.generate_structured(
            LLMRequest(
                role="memory",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You consolidate several recent agent observations into one higher-level key memory. "
                            "Return JSON only. Create a summary only when the events clearly form a recurring pattern, "
                            "turning point, or durable belief that should shape future behavior."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "events": [event.model_dump(mode="json") for event in events],
                                "goal": goal.model_dump(mode="json") if goal is not None else None,
                                "suspicion_level": suspicion_level,
                                "recent_key_memories": [
                                    memory.model_dump(mode="json")
                                    for memory in recent_key_memories[-3:]
                                ],
                            }
                        ),
                    },
                ],
                response_format=MemoryConsolidationDecision,
                metadata={
                    "memory_consolidator": True,
                    "round_number": max((event.round_number for event in events), default=0),
                    "experiment_id": experiment_id or "",
                    "agent_id": agent_id or "",
                    "agent_name": agent_name or "",
                },
                generation_name=f"memory:consolidate:{agent_name}" if agent_name else "memory:consolidate",
            )
        )
        return MemoryConsolidationDecision.model_validate(
            _require_parsed_result(result, operation="memory consolidation")
        )

    async def consolidate_relationship_memory(
        self,
        *,
        other_agent_id: str,
        relationship: RelationshipMemory,
        goal: SecretGoal | None,
        suspicion_level: float,
        experiment_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
        round_number: int | None = None,
    ) -> RelationshipConsolidationDecision:
        result = await self.client.generate_structured(
            LLMRequest(
                role="memory",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You compress an agent's recent interpersonal history into one stable impression. "
                            "Return JSON only. Update notes only when the interaction history supports a durable "
                            "relationship pattern that should influence future behavior."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "other_agent_id": other_agent_id,
                                "relationship": relationship.model_dump(mode="json"),
                                "goal": goal.model_dump(mode="json") if goal is not None else None,
                                "suspicion_level": suspicion_level,
                            }
                        ),
                    },
                ],
                response_format=RelationshipConsolidationDecision,
                metadata={
                    "relationship_consolidator": True,
                    "round_number": round_number or 0,
                    "experiment_id": experiment_id or "",
                    "agent_id": agent_id or "",
                    "agent_name": agent_name or "",
                },
                generation_name=f"memory:relationship:{agent_name}" if agent_name else "memory:relationship",
            )
        )
        return RelationshipConsolidationDecision.model_validate(
            _require_parsed_result(result, operation="relationship consolidation")
        )


def _require_parsed_result(result: LLMResult, *, operation: str) -> dict[str, object]:
    if result.parsed is None:
        raise ValueError(f"{operation} returned no parsed structured payload")
    return result.parsed
