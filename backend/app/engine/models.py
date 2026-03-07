from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.agents.models import AgentContext, AgentMemoryState, AgentTurnResult, PersonalityProfile, SecretGoal
from app.gm.models import DirectorArc, GMPlanRecord
from app.world.models import WorldState

PhaseName = Literal["gm_plan", "dawn", "morning", "midday", "afternoon", "night"]


class EngineModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class EngineAgentState(EngineModel):
    agent_id: str
    name: str
    personality: PersonalityProfile
    goal: SecretGoal
    memory: AgentMemoryState
    location: str | None = None
    inventory: list[str] = Field(default_factory=list)
    relationships: dict[str, object] = Field(default_factory=dict)
    suspicion_level: float = Field(ge=0, le=100, default=0)
    llm_model: str = "openai/gpt-4o-mini"


class ConflictRecord(EngineModel):
    location: str
    action_type: str
    participants: list[str]
    winner_ids: list[str] = Field(default_factory=list)
    loser_ids: list[str] = Field(default_factory=list)
    summary: str


class RoundEvent(EngineModel):
    phase: PhaseName
    summary: str
    data: dict[str, object] = Field(default_factory=dict)


class PhaseResult(EngineModel):
    phase: PhaseName
    events: list[RoundEvent] = Field(default_factory=list)
    cooperation_ratio: float | None = None
    conflicts: list[ConflictRecord] = Field(default_factory=list)


class SimulationState(EngineModel):
    experiment_id: str
    experiment_name: str
    total_rounds: int = Field(ge=1)
    current_round: int = Field(ge=0)
    status: str = "setup"
    auto_approve: bool = False
    arc: DirectorArc
    world_state: WorldState
    agents: list[EngineAgentState]
    unresolved_plotlines: list[str] = Field(default_factory=list)
    recent_events: list[str] = Field(default_factory=list)
    gm_plan: GMPlanRecord | None = None


class RoundResult(EngineModel):
    round_number: int
    gm_plan: GMPlanRecord
    phases: list[PhaseResult]
    cooperation_ratio: float = Field(ge=0, le=1)
    threat_level: float = Field(ge=0, le=100)
    world_state: WorldState
    agent_turns: dict[str, list[AgentTurnResult]] = Field(default_factory=dict)
    created_at: datetime


class MeetingOutcome(EngineModel):
    proposal: str
    votes: dict[str, str]
    summary: str


def build_agent_context(
    agent: EngineAgentState,
    *,
    world_state: WorldState,
    current_crisis: dict[str, object] | None,
    observations: list[dict[str, object]],
) -> AgentContext:
    from app.agents.models import Observation

    return AgentContext(
        agent_id=agent.agent_id,
        name=agent.name,
        personality=agent.personality,
        goal=agent.goal,
        memory=agent.memory,
        location=agent.location,
        inventory=agent.inventory,
        relationships=agent.relationships,  # type: ignore[arg-type]
        suspicion_level=agent.suspicion_level,
        world_state=world_state,
        current_crisis=current_crisis,
        observations=[Observation.model_validate(item) for item in observations],
    )
