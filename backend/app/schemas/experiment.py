from uuid import UUID

from pydantic import Field

from app.db.models import ExperimentStatus
from app.schemas.agent import AgentRead
from app.schemas.arc import ArcRead
from app.schemas.common import APIModel
from app.world.models import WorldState


class ResourceState(APIModel):
    food: float = 0
    water: float = 0
    materials: float = 0
    power: float = 0


class ExperimentRead(APIModel):
    id: UUID
    name: str
    status: ExperimentStatus
    current_round: int = Field(ge=0)
    total_rounds: int = Field(ge=1)
    threat_level: float = Field(ge=0, le=100)
    resources: ResourceState
    arc: ArcRead
    agents: list[AgentRead] = Field(min_length=6, max_length=12)
    world_state: WorldState | None = None
