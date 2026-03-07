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
)
from app.gm.models import DirectorArc, GMPlanData, GMPlanRecord


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
