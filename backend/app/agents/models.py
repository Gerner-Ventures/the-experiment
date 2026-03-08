from __future__ import annotations

from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field

from app.actions import (
    ACTION_IDS,
    CONSEQUENCE_ACTION_IDS,
    ActionCategory,
    ActionName,
    ConsequenceActionName,
)
from app.db.models import AgentStatus
from app.llm.models import MemorySalienceType
from app.schemas.agent_decision import AgentDecision
from app.world.models import WorldState

PersonalityAxis = Literal[
    "paranoia", "empathy", "dominance", "impulsiveness", "loyalty", "ambition"
]
GoalArchetype = Literal[
    "communal_survival",
    "protective_attachment",
    "status_power",
    "resource_control",
    "escape_exit",
    "truth_revelation",
    "social_disruption",
    "belief_transformation",
    "personal_redemption",
    "obsession_desire",
]
ConsequenceActionType = ConsequenceActionName
ActionType = ActionName
SuspicionTrigger = Literal[
    "edge_of_map", "failed_action", "observer_event", "paranoia_spread", "meta_signal"
]

CURATED_TRAIT_TAGS: tuple[str, ...] = (
    "charming",
    "guarded",
    "scheming",
    "dutiful",
    "resentful",
    "tender",
    "fatalistic",
    "devout",
    "vain",
    "performative",
    "jealous",
    "curious",
    "stoic",
    "reckless",
    "calculating",
    "naive",
    "protective",
    "gossipy",
    "melancholic",
    "aspirational",
    "superstitious",
    "flirtatious",
    "ruthless",
    "lonely",
)
CONSEQUENCE_ACTION_TYPES: tuple[ConsequenceActionType, ...] = cast(
    tuple[ConsequenceActionType, ...], CONSEQUENCE_ACTION_IDS
)
ACTION_TYPES: tuple[ActionType, ...] = cast(tuple[ActionType, ...], ACTION_IDS)


class AgentModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PersonalityAxes(AgentModel):
    paranoia: int = Field(ge=0, le=100)
    empathy: int = Field(ge=0, le=100)
    dominance: int = Field(ge=0, le=100)
    impulsiveness: int = Field(ge=0, le=100)
    loyalty: int = Field(ge=0, le=100)
    ambition: int = Field(ge=0, le=100)


class PersonalityProfile(AgentModel):
    axes: PersonalityAxes
    trait_tags: list[str] = Field(min_length=2, max_length=4)
    self_concept: str | None = None


class SecretGoal(AgentModel):
    archetype: GoalArchetype
    text: str
    target_agent_id: str | None = None
    target_location_id: str | None = None
    progress_signals: list[str] = Field(default_factory=list)


class MemoryEvent(AgentModel):
    round_number: int = Field(ge=0)
    summary: str
    emotional_charge: int = Field(ge=-100, le=100, default=0)
    tags: list[str] = Field(default_factory=list)


class KeyMemory(AgentModel):
    summary: str
    meaning: str
    round_number: int = Field(ge=0)
    confidence: int = Field(ge=0, le=100, default=70)
    salience_type: MemorySalienceType = "other"


class RelationshipMemory(AgentModel):
    trust: float = Field(default=0, ge=-100, le=100)
    history: list[str] = Field(default_factory=list)
    notes: str | None = None


class AgentMemoryState(AgentModel):
    recent_events: list[MemoryEvent] = Field(default_factory=list)
    key_memories: list[KeyMemory] = Field(default_factory=list)
    relationship_memory: dict[str, RelationshipMemory] = Field(default_factory=dict)
    relationship_consolidation_signatures: dict[str, str] = Field(default_factory=dict)
    last_consolidated_round: int = Field(ge=0, default=0)


class ActionDefinition(AgentModel):
    type: ActionType
    category: ActionCategory
    description: str
    requires_target: bool = False
    requires_location: bool = False


class Observation(AgentModel):
    summary: str
    importance: int = Field(ge=1, le=5, default=3)


class SuspicionUpdate(AgentModel):
    trigger: SuspicionTrigger
    delta: float
    note: str


class AgentContext(AgentModel):
    experiment_id: str | None = None
    agent_id: str
    name: str
    character_id: str | None = None
    status: AgentStatus = AgentStatus.IDLE
    personality: PersonalityProfile
    goal: SecretGoal
    memory: AgentMemoryState
    location: str | None = None
    inventory: list[str] = Field(default_factory=list)
    relationships: dict[str, RelationshipMemory] = Field(default_factory=dict)
    suspicion_level: float = Field(ge=0, le=100, default=0)
    world_state: WorldState
    current_crisis: dict[str, object] | None = None
    observations: list[Observation] = Field(default_factory=list)


class AgentTurnResult(AgentModel):
    decision: AgentDecision
    updated_memory: AgentMemoryState
    suspicion_level: float = Field(ge=0, le=100)
    prompt: str
