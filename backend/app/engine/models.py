from __future__ import annotations

from datetime import datetime
from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from app.actions import DecisionActionName
from app.agents.models import (
    AgentContext,
    AgentMemoryState,
    AgentTurnResult,
    PersonalityProfile,
    RelationshipMemory,
    SecretGoal,
)
from app.db.models import AgentStatus
from app.gm.models import DirectorArc, GMPlanRecord
from app.world.models import WorldState

PhaseName = Literal["gm_plan", "dawn", "morning", "midday", "afternoon", "night"]


@runtime_checkable
class RoundHook(Protocol):
    """Callback interface for streaming round progress out of the engine.

    The engine calls these methods at phase boundaries and per-agent-action,
    allowing the runtime to broadcast WS messages without duplicating round logic.
    """

    async def on_round_start(self, round_number: int, gm_plan: GMPlanRecord) -> None: ...

    async def on_phase_start(self, round_number: int, phase: PhaseName) -> None: ...

    async def on_phase_complete(self, round_number: int, phase_result: PhaseResult) -> None: ...

    async def on_agent_action(
        self,
        round_number: int,
        phase: PhaseName,
        agent: EngineAgentState,
        turn: AgentTurnResult,
    ) -> None: ...


class NullHook:
    """No-op hook for non-streaming callers."""

    async def on_round_start(self, round_number: int, gm_plan: GMPlanRecord) -> None:
        pass

    async def on_phase_start(self, round_number: int, phase: PhaseName) -> None:
        pass

    async def on_phase_complete(self, round_number: int, phase_result: PhaseResult) -> None:
        pass

    async def on_agent_action(
        self,
        round_number: int,
        phase: PhaseName,
        agent: EngineAgentState,
        turn: AgentTurnResult,
    ) -> None:
        pass


ConversationTone = Literal["supportive", "suspicious", "manipulative", "guarded"]
MeetingStance = Literal["support", "oppose", "hesitant"]
MeetingVoteChoice = Literal["support", "oppose", "abstain"]
ExileVoteChoice = Literal["banish", "protect", "abstain"]
FactionKind = Literal["alliance", "cult"]
TerminalActionType = Literal[DecisionActionName.SELF_SACRIFICE]
ActionResolutionOutcome = Literal[
    "resolved",
    "blocked",
    "rerouted",
    "conflict_winner",
    "conflict_loser",
    "self_sacrifice",
]


class EngineModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class EngineAgentState(EngineModel):
    agent_id: str
    name: str
    character_id: str | None = None
    status: AgentStatus = AgentStatus.IDLE
    personality: PersonalityProfile
    goal: SecretGoal
    memory: AgentMemoryState
    location: str | None = None
    tile_x: int | None = Field(default=None, ge=0)
    tile_y: int | None = Field(default=None, ge=0)
    inventory: list[str] = Field(default_factory=list)
    relationships: dict[str, RelationshipMemory] = Field(default_factory=dict)
    suspicion_level: float = Field(ge=0, le=100, default=0)
    llm_model: str = "openai/gpt-4o-mini"
    faction_id: str | None = None
    faction_role: Literal["leader", "member"] | None = None
    influence: float = Field(default=0, ge=0, le=100)
    death_round: int | None = Field(default=None, ge=0)
    death_cause: str | None = Field(default=None, max_length=100)


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
    factions: list["FactionState"] = Field(default_factory=list)
    exile_history: list["ExileOutcome"] = Field(default_factory=list)
    sacrifice_history: list["SacrificeOutcome"] = Field(default_factory=list)


class RoundResult(EngineModel):
    round_number: int
    gm_plan: GMPlanRecord
    phases: list[PhaseResult]
    cooperation_ratio: float = Field(ge=0, le=1)
    threat_level: float = Field(ge=0, le=100)
    world_state: WorldState
    agent_turns: dict[str, list[AgentTurnResult]] = Field(default_factory=dict)
    action_resolutions: list["ActionResolution"] = Field(default_factory=list)
    created_at: datetime


class ActionResolution(EngineModel):
    phase: Literal["morning", "afternoon"]
    agent_id: str
    agent_name: str
    location: str
    requested_action_type: str
    resolved_action_type: str
    outcome: ActionResolutionOutcome = "resolved"
    cooperation_intent: str
    goal_progress: str
    summary: str
    target: str | None = None
    dialogue_target: str | None = None
    suspicion_level: float = Field(ge=0, le=100)
    is_consequence: bool = False
    source_agent_id: str | None = None
    source_agent_name: str | None = None
    source_action_type: str | None = None


class ConversationTurn(EngineModel):
    speaker_id: str
    speaker_name: str
    listener_id: str
    listener_name: str
    tone: ConversationTone
    content: str
    trust_delta: float = 0


class ConversationOutcome(EngineModel):
    location: str
    participants: list[str]
    turns: list[ConversationTurn] = Field(default_factory=list)
    summary: str


class MeetingSpeech(EngineModel):
    agent_id: str
    agent_name: str
    stance: MeetingStance
    content: str


class MeetingVote(EngineModel):
    agent_id: str
    agent_name: str
    vote: MeetingVoteChoice
    rationale: str


class ExileVote(EngineModel):
    agent_id: str
    agent_name: str
    vote: ExileVoteChoice
    rationale: str


class ExileOutcome(EngineModel):
    round_number: int = Field(ge=0)
    target_agent_id: str | None = None
    target_agent_name: str | None = None
    votes: dict[str, ExileVoteChoice] = Field(default_factory=dict)
    vote_rationales: dict[str, str] = Field(default_factory=dict)
    tally: dict[str, int] = Field(default_factory=dict)
    enacted: bool = False
    reason: str | None = None


class SacrificeOutcome(EngineModel):
    round_number: int = Field(ge=0)
    agent_id: str
    agent_name: str
    location: str
    action_type: TerminalActionType
    reason: str
    threat_delta: float = 0.0
    resource_effects: dict[str, float] = Field(default_factory=dict)
    affected_agent_ids: list[str] = Field(default_factory=list)


class FactionState(EngineModel):
    faction_id: str
    name: str
    kind: FactionKind
    leader_id: str
    member_ids: list[str] = Field(default_factory=list)
    doctrine: str | None = None
    influence: float = Field(default=0, ge=0, le=100)
    formed_round: int = Field(ge=0)
    pressure: float = Field(default=0, ge=0, le=100)


class MeetingOutcome(EngineModel):
    proposal: str
    speeches: list[MeetingSpeech] = Field(default_factory=list)
    votes: dict[str, MeetingVoteChoice]
    vote_rationales: dict[str, str] = Field(default_factory=dict)
    tally: dict[str, int] = Field(default_factory=dict)
    passed: bool = False
    summary: str
    exile: ExileOutcome | None = None
    faction_pressures: list[str] = Field(default_factory=list)


def build_agent_context(
    agent: EngineAgentState,
    *,
    experiment_id: str | None,
    world_state: WorldState,
    current_crisis: dict[str, object] | None,
    observations: list[dict[str, object]],
) -> AgentContext:
    from app.agents.models import Observation

    return AgentContext(
        experiment_id=experiment_id,
        agent_id=agent.agent_id,
        name=agent.name,
        character_id=agent.character_id,
        status=agent.status,
        personality=agent.personality,
        goal=agent.goal,
        memory=agent.memory,
        location=agent.location,
        inventory=agent.inventory,
        relationships=agent.relationships,
        suspicion_level=agent.suspicion_level,
        world_state=world_state,
        current_crisis=current_crisis,
        observations=[Observation.model_validate(item) for item in observations],
    )
