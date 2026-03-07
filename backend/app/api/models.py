from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.agents.models import PersonalityProfile, SecretGoal
from app.engine.models import (
    EngineAgentState,
    ExileOutcome,
    FactionState,
    RoundResult,
    SacrificeOutcome,
)
from app.gm.models import DirectorArc, GMPlanData, GMPlanRecord
from app.llm.models import UsageRecord, UsageSummary


class APIRequestModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AgentCreateRequest(APIRequestModel):
    name: str
    character_id: str | None = None
    personality: PersonalityProfile
    goal: SecretGoal
    llm_model: str = "openai/gpt-4o-mini"
    location: str | None = None
    inventory: list[str] = Field(default_factory=list)


class CreateExperimentRequest(APIRequestModel):
    name: str
    total_rounds: int = Field(default=15, ge=1)
    auto_approve: bool = False
    preset_arc_id: str = "lord_of_the_flies"
    arc: DirectorArc | None = None
    agents: list[AgentCreateRequest] = Field(default_factory=list)


class ExperimentSummary(APIRequestModel):
    experiment_id: str
    experiment_name: str
    status: str
    current_round: int
    total_rounds: int
    auto_approve: bool
    world_state: dict[str, Any]


class ExperimentDetail(APIRequestModel):
    experiment_id: str
    experiment_name: str
    status: str
    current_round: int
    total_rounds: int
    auto_approve: bool
    arc: DirectorArc
    world_state: dict[str, Any]
    agents: list[EngineAgentState]
    gm_plan: GMPlanRecord | None = None
    unresolved_plotlines: list[str] = Field(default_factory=list)
    factions: list[FactionState] = Field(default_factory=list)
    exile_history: list[ExileOutcome] = Field(default_factory=list)
    sacrifice_history: list[SacrificeOutcome] = Field(default_factory=list)


class ObserverEventRequest(APIRequestModel):
    description: str


class ApproveGMPlanRequest(APIRequestModel):
    modified_plan: GMPlanData | None = None


class UpdateArcRequest(APIRequestModel):
    arc: DirectorArc


EventLogType = Literal[
    "experiment_created",
    "experiment_started",
    "experiment_paused",
    "observer_event",
    "arc_updated",
    "gm_plan_generated",
    "gm_plan_approved",
    "gm_plan",
    "dawn",
    "morning",
    "midday",
    "afternoon",
    "night",
    "round_start",
    "round_end",
    "phase_change",
    "agent_action",
    "agent_move",
    "faction_update",
    "cult_activity",
    "exile_vote",
    "exile_enacted",
    "crisis_event",
    "threat_update",
    "resource_update",
    "experiment_end",
]


class EventLogItem(APIRequestModel):
    id: str
    experiment_id: str
    round_number: int | None = None
    phase: str | None = None
    agent_id: str | None = None
    type: EventLogType
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime


class EventLogPage(APIRequestModel):
    items: list[EventLogItem]
    total: int
    limit: int
    offset: int


class StepResponse(APIRequestModel):
    round_result: RoundResult
    experiment: ExperimentDetail


class UsageGroup(APIRequestModel):
    key: str
    label: str
    request_count: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


class UsageReport(APIRequestModel):
    summary: UsageSummary
    by_role: list[UsageGroup] = Field(default_factory=list)
    by_model: list[UsageGroup] = Field(default_factory=list)
    by_agent: list[UsageGroup] = Field(default_factory=list)
    by_round: list[UsageGroup] = Field(default_factory=list)


class PromptTracePage(APIRequestModel):
    items: list[UsageRecord] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class RelationshipEdge(APIRequestModel):
    source_agent_id: str
    source_agent_name: str
    target_agent_id: str
    target_agent_name: str
    trust: float
    faction_id: str | None = None


class AnalyticsSummary(APIRequestModel):
    experiment_id: str
    rounds_completed: int = 0
    active_agents: int = 0
    exiled_agents: int = 0
    faction_count: int = 0
    cult_count: int = 0
    cooperation_score: float = 0.0
    threat_level: float = 0.0
    dominant_faction: str | None = None
    current_resources: dict[str, float] = Field(default_factory=dict)


class HighlightItem(APIRequestModel):
    round_number: int | None = None
    score: float = 0.0
    category: str
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class ReplayRound(APIRequestModel):
    round_number: int
    summary: str
    threat_level: float = 0.0
    event_count: int = 0


class ReplayIndex(APIRequestModel):
    rounds: list[ReplayRound] = Field(default_factory=list)
    highlights: list[HighlightItem] = Field(default_factory=list)


class RoundSnapshotResponse(APIRequestModel):
    experiment_id: str
    round_number: int
    snapshot: dict[str, Any]
    events: list[EventLogItem] = Field(default_factory=list)


class RelationshipAnalytics(APIRequestModel):
    items: list[RelationshipEdge] = Field(default_factory=list)


class FactionAnalytics(APIRequestModel):
    items: list[FactionState] = Field(default_factory=list)


class HighlightPage(APIRequestModel):
    items: list[HighlightItem] = Field(default_factory=list)
