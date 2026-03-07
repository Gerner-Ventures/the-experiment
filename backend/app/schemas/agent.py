from uuid import UUID

from pydantic import Field

from app.db.models import AgentStatus
from app.agents.models import AgentMemoryState, PersonalityAxes, SecretGoal
from app.schemas.common import APIModel


class Personality(APIModel):
    axes: PersonalityAxes
    trait_tags: list[str] = Field(default_factory=list)
    self_concept: str | None = None


class Relationship(APIModel):
    trust: float | None = Field(default=None, ge=-100, le=100)
    notes: str | None = None


class AgentRead(APIModel):
    id: UUID
    name: str
    character_id: str | None = None
    personality: Personality
    secret_goal: str
    goal_archetype: str | None = None
    goal: SecretGoal | None = None
    llm_model: str
    location: str | None = None
    status: AgentStatus = AgentStatus.IDLE
    suspicion_level: float = Field(default=0, ge=0, le=100)
    inventory: list[str] = Field(default_factory=list)
    memory: AgentMemoryState | None = None
    relationships: dict[str, Relationship] = Field(default_factory=dict)
