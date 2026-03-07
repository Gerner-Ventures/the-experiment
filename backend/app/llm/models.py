from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

LLMRole = Literal["gm", "agent", "memory"]
MemorySalienceType = Literal[
    "threat", "betrayal", "goal_clue", "relationship", "resource", "identity", "other"
]


class LLMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LLMModelConfig(LLMModel):
    role: LLMRole
    primary_model: str
    fallback_models: list[str] = Field(default_factory=list)
    temperature: float = 0.8
    timeout_seconds: float = 45.0


class LLMRequest(LLMModel):
    role: LLMRole
    messages: list[dict[str, Any]]
    response_format: dict[str, Any] | type[BaseModel] | None = None
    model_override: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    temperature: float | None = None


class LLMUsage(LLMModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


class LLMResult(LLMModel):
    model: str
    provider: str | None = None
    content: str
    parsed: dict[str, Any] | None = None
    usage: LLMUsage = Field(default_factory=LLMUsage)
    raw_response: dict[str, Any] = Field(default_factory=dict)
    repaired: bool = False


class UsageRecord(LLMModel):
    role: LLMRole
    model: str
    provider: str | None = None
    experiment_id: str | None = None
    round_number: int | None = None
    agent_id: str | None = None
    prompt_messages: list[dict[str, Any]] = Field(default_factory=list)
    response_content: str = ""
    parsed_response: dict[str, Any] | None = None
    repaired: bool = False
    raw_response: dict[str, Any] = Field(default_factory=dict)
    usage: LLMUsage
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class UsageSummary(LLMModel):
    request_count: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


class RepairAttempt(LLMModel):
    original_text: str
    error: str


class MemoryPromotionDecision(LLMModel):
    promote_to_key_memory: bool = False
    meaning: str | None = None
    salience_type: MemorySalienceType = "other"
    confidence: int = Field(ge=0, le=100, default=60)


class MemoryConsolidationDecision(LLMModel):
    create_summary: bool = False
    summary: str | None = None
    meaning: str | None = None
    salience_type: MemorySalienceType = "other"
    confidence: int = Field(ge=0, le=100, default=65)


class RelationshipConsolidationDecision(LLMModel):
    update_notes: bool = False
    notes: str | None = None
