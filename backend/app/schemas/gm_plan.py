from datetime import datetime

from pydantic import Field

from app.schemas.common import APIModel


class CrisisEvent(APIModel):
    type: str
    description: str
    affects: list[str] = Field(default_factory=list)
    severity: str


class ResourceModifiers(APIModel):
    food: float = 0
    water: float = 0
    materials: float = 0
    power: float = 0


class GMPlanRead(APIModel):
    round: int
    round_theme: str
    reasoning: str
    crisis_event: CrisisEvent
    resource_modifiers: ResourceModifiers
    environmental: str | None = None
    narration: str
    meta_hint: str | None = None


class GMPlanEnvelope(APIModel):
    status: str
    approved_at: datetime | None = None
    applied_at: datetime | None = None
    plan: GMPlanRead
