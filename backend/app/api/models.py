from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.agents.models import PersonalityProfile, SecretGoal
from app.db.models import AgentStatus
from app.engine.models import (
    EngineAgentState,
    ExileOutcome,
    FactionKind,
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
    auto_approve: bool = True
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


class ReviseGMPlanRequest(APIRequestModel):
    feedback: str

    @field_validator("feedback")
    @classmethod
    def _normalize_feedback(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Feedback cannot be blank.")
        if len(normalized) > 500:
            raise ValueError("Feedback must be 500 characters or fewer.")
        return normalized


class UpdateArcRequest(APIRequestModel):
    arc: DirectorArc


EventLogType = Literal[
    "experiment_created",
    "experiment_started",
    "experiment_paused",
    "observer_event",
    "arc_updated",
    "gm_plan_generated",
    "gm_plan_feedback",
    "gm_plan_revised",
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


class StepStartedResponse(APIRequestModel):
    status: str = "step_started"
    round_number: int
    experiment_id: str


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


class UpdateRuntimeLLMModeRequest(APIRequestModel):
    mode: Literal["live", "mock"]


class RuntimeLLMModeResponse(APIRequestModel):
    mode: Literal["live", "mock"]
    llm_calls_enabled: bool


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


class AgentGoalProgress(APIRequestModel):
    round_number: int
    phase: str | None = None
    requested_action_type: str
    resolved_action_type: str
    cooperation_intent: str
    progress: str
    summary: str


class GoalOutcomeSummary(APIRequestModel):
    agent_id: str
    agent_name: str
    goal_text: str
    goal_archetype: str
    status: AgentStatus
    outcome: Literal["achieved", "partial", "failed", "unknown"] = "unknown"
    latest_progress: str | None = None
    progress_history: list[AgentGoalProgress] = Field(default_factory=list)


class GoalAnalytics(APIRequestModel):
    items: list[GoalOutcomeSummary] = Field(default_factory=list)


class BetrayalTimelineItem(APIRequestModel):
    round_number: int
    phase: str | None = None
    category: Literal["sabotage", "hostile_action", "exile_vote", "exile_enacted"]
    summary: str
    agent_id: str | None = None
    agent_name: str | None = None
    target_agent_id: str | None = None
    target_agent_name: str | None = None
    requested_action_type: str | None = None
    resolved_action_type: str | None = None
    resolved: bool = True


class BetrayalAnalytics(APIRequestModel):
    items: list[BetrayalTimelineItem] = Field(default_factory=list)


class SuspicionPoint(APIRequestModel):
    round_number: int
    agent_id: str
    agent_name: str
    suspicion_level: float = 0.0


class SuspicionHistoryPoint(APIRequestModel):
    round_number: int
    suspicion_level: float = 0.0


class AgentSuspicionHistory(APIRequestModel):
    agent_id: str
    agent_name: str
    points: list[SuspicionHistoryPoint] = Field(default_factory=list)


class SuspicionAnalytics(APIRequestModel):
    heatmap: list[SuspicionPoint] = Field(default_factory=list)
    agents: list[AgentSuspicionHistory] = Field(default_factory=list)


class FactionTimelinePoint(APIRequestModel):
    round_number: int
    faction_id: str
    faction_name: str
    kind: FactionKind | None = None
    pressure: float = 0.0
    influence: float = 0.0
    member_ids: list[str] = Field(default_factory=list)


class FactionMembershipChange(APIRequestModel):
    round_number: int
    faction_id: str
    faction_name: str
    joined_agent_ids: list[str] = Field(default_factory=list)
    left_agent_ids: list[str] = Field(default_factory=list)


class GMRoundTimelineItem(APIRequestModel):
    round_number: int
    round_theme: str
    narration: str
    crisis_event: dict[str, Any] = Field(default_factory=dict)


class GMTimelinePage(APIRequestModel):
    items: list[GMRoundTimelineItem] = Field(default_factory=list)


HighlightScope = Literal["round", "game"]
HighlightCategory = Literal[
    "crisis",
    "betrayal",
    "resource_swing",
    "alliance_shift",
    "close_vote",
    "suspicion_spike",
]


class HighlightItem(APIRequestModel):
    id: str
    round_number: int
    phase: str | None = None
    score: float = Field(ge=0)
    category: HighlightCategory
    event_type: str
    event_kind: str | None = None
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class RoundAnalyticsItem(APIRequestModel):
    round_number: int
    summary: str
    gm_round_theme: str
    gm_narration: str
    crisis_event: dict[str, Any] = Field(default_factory=dict)
    cooperation_score: float = 0.0
    cooperative_actions: int = 0
    total_actions: int = 0
    betrayal_count: int = 0
    sabotage_count: int = 0
    threat_level: float = 0.0
    resources: dict[str, float] = Field(default_factory=dict)
    faction_count: int = 0
    dominant_faction: str | None = None


class RoundAnalyticsPage(APIRequestModel):
    items: list[RoundAnalyticsItem] = Field(default_factory=list)


class ReplayRound(APIRequestModel):
    round_number: int
    summary: str
    threat_level: float = 0.0
    event_count: int = 0
    cooperation_score: float = 0.0
    betrayal_count: int = 0
    sabotage_count: int = 0
    resources: dict[str, float] = Field(default_factory=dict)
    gm_round_theme: str = ""
    gm_narration: str = ""


class ReplayIndex(APIRequestModel):
    rounds: list[ReplayRound] = Field(default_factory=list)
    highlights: list[HighlightItem] = Field(default_factory=list)


class RoundSnapshotResponse(APIRequestModel):
    experiment_id: str
    round_number: int
    snapshot: dict[str, Any]
    events: list[EventLogItem] = Field(default_factory=list)


NarrationAudioStatus = Literal["pending", "ready", "unavailable"]


class NarrationAudioMetadata(APIRequestModel):
    experiment_id: str
    round_number: int
    text: str
    voice_id: str
    model_id: str
    output_format: str
    status: NarrationAudioStatus
    audio_url: str | None = None
    cache_hit: bool = False


class AgentSpeechAudioMetadata(APIRequestModel):
    experiment_id: str
    agent_id: str
    round_number: int
    index: int
    text: str
    voice_id: str
    model_id: str
    output_format: str
    status: NarrationAudioStatus
    audio_url: str | None = None
    cache_hit: bool = False


class RelationshipAnalytics(APIRequestModel):
    items: list[RelationshipEdge] = Field(default_factory=list)


class FactionAnalytics(APIRequestModel):
    items: list[FactionState] = Field(default_factory=list)
    timeline: list[FactionTimelinePoint] = Field(default_factory=list)
    membership_changes: list[FactionMembershipChange] = Field(default_factory=list)


class HighlightPage(APIRequestModel):
    scope: HighlightScope = "game"
    round_number: int | None = None
    items: list[HighlightItem] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_round_scope(self) -> "HighlightPage":
        if self.scope == "round" and self.round_number is None:
            raise ValueError("round_number is required when scope=round")
        if self.scope == "game" and self.round_number is not None:
            raise ValueError("round_number must be omitted when scope=game")
        return self
