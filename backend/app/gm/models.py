from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import ResourcePressure
from app.world.models import WorldState

CrisisType = Literal["resource", "structural", "social", "environmental", "discovery", "meta"]
CrisisSeverity = Literal["low", "medium", "high", "critical"]
GMPlanStatus = Literal["pending", "approved", "modified", "applied"]


class GMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class DirectorAct(GMModel):
    name: str
    start_round: int = Field(ge=1)
    end_round: int = Field(ge=1)
    tone: str
    gm_instructions: str
    resource_pressure: ResourcePressure
    director_notes: str | None = None


class DirectorArc(GMModel):
    name: str
    description: str
    acts: list[DirectorAct] = Field(min_length=1)


class CrisisTemplate(GMModel):
    type: CrisisType
    title: str
    description_template: str
    environmental: str | None = None
    base_affects: list[str] = Field(default_factory=list)
    resource_modifiers: "ResourceDelta" = Field(default_factory=lambda: ResourceDelta())


class CrisisEvent(GMModel):
    type: CrisisType
    description: str
    affects: list[str] = Field(default_factory=list)
    severity: CrisisSeverity


class GMPlanData(GMModel):
    round: int = Field(ge=1)
    round_theme: str
    reasoning: str
    crisis_event: CrisisEvent
    resource_modifiers: "ResourceDelta"
    environmental: str | None = None
    narration: str
    meta_hint: str | None = None


class GMPlanningContext(GMModel):
    experiment_id: str | None = None
    round_number: int = Field(ge=1)
    total_rounds: int = Field(ge=1)
    arc: DirectorArc
    world_state: WorldState
    threat_level: float = Field(ge=0, le=100)
    cooperation_ratio: float = Field(ge=0, le=1)
    unresolved_plotlines: list[str] = Field(default_factory=list)
    relationships_summary: str = ""
    recent_events: list[str] = Field(default_factory=list)
    auto_approve: bool = False


class PromptPackage(GMModel):
    system_prompt: str
    user_prompt: str
    response_schema: dict[str, object]


class GMPlanRecord(GMModel):
    status: GMPlanStatus = "pending"
    plan: GMPlanData
    approved_at: datetime | None = None
    applied_at: datetime | None = None


class ResourceDelta(GMModel):
    food: float = 0.0
    water: float = 0.0
    materials: float = 0.0
    power: float = 0.0
