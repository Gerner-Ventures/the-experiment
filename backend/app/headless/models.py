from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.api.models import AnalyticsSummary, CreateExperimentRequest, HighlightItem
from app.engine import SimulationState

HeadlessMode = Literal["mock", "live"]


class HeadlessModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class HeadlessRunMetadata(HeadlessModel):
    mode: HeadlessMode
    seed: int
    config_source: str
    started_at: datetime
    completed_at: datetime
    duration_seconds: float = Field(ge=0)


class AgentActionSummary(HeadlessModel):
    agent_id: str
    agent_name: str
    action_index: int = Field(ge=1)
    action_type: str
    location: str | None = None
    cooperation_intent: str
    goal_progress: str


class ValidationResult(HeadlessModel):
    key: str
    passed: bool
    detail: str


class RoundSummary(HeadlessModel):
    round_number: int
    theme: str
    crisis: str
    cooperation_ratio: float = Field(ge=0, le=1)
    threat_level: float = Field(ge=0, le=100)
    resources: dict[str, float] = Field(default_factory=dict)
    notable_events: list[str] = Field(default_factory=list)
    agent_actions: list[AgentActionSummary] = Field(default_factory=list)


class HeadlessRunReport(HeadlessModel):
    metadata: HeadlessRunMetadata
    request: CreateExperimentRequest
    final_state: SimulationState
    analytics_summary: AnalyticsSummary
    highlights: list[HighlightItem] = Field(default_factory=list)
    validations: list[ValidationResult] = Field(default_factory=list)
    rounds: list[RoundSummary] = Field(default_factory=list)
