from pydantic import Field

from app.db.models import ResourcePressure
from app.schemas.common import APIModel


class ActRead(APIModel):
    name: str
    start_round: int = Field(ge=1)
    end_round: int = Field(ge=1)
    tone: str
    gm_instructions: str
    resource_pressure: ResourcePressure
    director_notes: str | None = None


class ArcRead(APIModel):
    name: str
    description: str | None = None
    acts: list[ActRead] = Field(min_length=1)
