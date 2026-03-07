from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TileType = Literal["empty", "path", "grass", "building", "water", "fence", "field"]
LocationType = Literal[
    "residence",
    "store",
    "bar",
    "brothel",
    "water_source",
    "meeting_hall",
    "workshop",
    "farm",
    "boundary",
    "mystery",
]
ResourceName = Literal["food", "water", "materials", "power"]


class WorldModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Tile(WorldModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    tile_type: TileType
    walkable: bool
    location_id: str | None = None


class Location(WorldModel):
    id: str
    name: str
    type: LocationType
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    capacity: int = Field(ge=1)
    eerie: bool = False
    gather_bonus: dict[ResourceName, float] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    description: str


class WorldMap(WorldModel):
    name: str
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    tiles: list[Tile]
    locations: list[Location]

    @field_validator("tiles")
    @classmethod
    def validate_tile_count(cls, tiles: list[Tile], info: object) -> list[Tile]:
        if not hasattr(info, "data"):
            return tiles
        data = getattr(info, "data")
        width = data.get("width")
        height = data.get("height")
        if isinstance(width, int) and isinstance(height, int):
            expected = width * height
            if len(tiles) != expected:
                msg = f"expected {expected} tiles for a {width}x{height} world, got {len(tiles)}"
                raise ValueError(msg)
        return tiles


class ResourceState(WorldModel):
    food: float = Field(ge=0, default=24.0)
    water: float = Field(ge=0, default=30.0)
    materials: float = Field(ge=0, default=14.0)
    power: float = Field(ge=0, default=10.0)


class ResourceTick(WorldModel):
    base_decay: ResourceState = Field(
        default_factory=lambda: ResourceState(food=1.4, water=1.0, materials=1.8, power=2.2)
    )
    location_modifiers: dict[ResourceName, float] = Field(default_factory=dict)
    crisis_modifiers: dict[ResourceName, float] = Field(default_factory=dict)
    action_modifiers: dict[ResourceName, float] = Field(default_factory=dict)


class WorldState(WorldModel):
    map_name: str
    round_number: int = Field(ge=0)
    resources: ResourceState
    threat_level: float = Field(ge=0, le=100)
    active_modifiers: dict[str, dict[str, float]] = Field(default_factory=dict)
    location_occupancy: dict[str, list[str]] = Field(default_factory=dict)
