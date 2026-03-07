from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.world.models import ResourceName, ResourceState, ResourceTick, WorldMap, WorldState

WORLD_DIR = Path(__file__).resolve().parent
DEFAULT_WORLD_MAP_PATH = WORLD_DIR / "data" / "default_town.json"


def load_default_world_map() -> WorldMap:
    return WorldMap.model_validate_json(DEFAULT_WORLD_MAP_PATH.read_text())


DEFAULT_WORLD_MAP = load_default_world_map()


def build_default_world_state(round_number: int = 0) -> WorldState:
    return WorldState(
        map_name=DEFAULT_WORLD_MAP.name,
        round_number=round_number,
        resources=ResourceState(),
        threat_level=12.0,
        active_modifiers={
            "base_decay": ResourceTick().base_decay.model_dump(),
            "world_bias": {"materials": -0.3, "power": -0.5},
        },
        location_occupancy={location.id: [] for location in DEFAULT_WORLD_MAP.locations},
    )


def apply_resource_tick(
    current: ResourceState,
    tick: ResourceTick | None = None,
) -> ResourceState:
    resource_tick = tick or ResourceTick()
    next_values: dict[str, float] = {}
    resource_names: tuple[ResourceName, ...] = ("food", "water", "materials", "power")

    for resource_name in resource_names:
        current_value = getattr(current, resource_name)
        delta = -getattr(resource_tick.base_decay, resource_name)
        delta += resource_tick.location_modifiers.get(resource_name, 0.0)
        delta += resource_tick.crisis_modifiers.get(resource_name, 0.0)
        delta += resource_tick.action_modifiers.get(resource_name, 0.0)
        next_values[resource_name] = max(0.0, round(current_value + delta, 2))

    return ResourceState(**next_values)


def calculate_threat_level(
    resources: ResourceState,
    cooperation_ratio: float,
    crisis_severity: float,
) -> float:
    bounded_cooperation = min(max(cooperation_ratio, 0.0), 1.0)
    bounded_crisis = min(max(crisis_severity, 0.0), 1.0)

    scarcity_pressure = _calculate_scarcity_pressure(resources)
    cooperation_pressure = (1.0 - bounded_cooperation) * 35.0
    crisis_pressure = bounded_crisis * 20.0
    baseline = 8.0

    return round(min(100.0, baseline + scarcity_pressure + cooperation_pressure + crisis_pressure), 2)


def create_world_snapshot(state: WorldState) -> dict[str, Any]:
    return state.model_dump(mode="json")


def restore_world_snapshot(snapshot: dict[str, Any]) -> WorldState:
    return WorldState.model_validate(snapshot)


def _calculate_scarcity_pressure(resources: ResourceState) -> float:
    thresholds = {
        "food": (24.0, 12.0),
        "water": (30.0, 10.0),
        "materials": (14.0, 18.0),
        "power": (10.0, 22.0),
    }
    pressure = 0.0

    for resource_name, (baseline, weight) in thresholds.items():
        current_value = getattr(resources, resource_name)
        scarcity = max(0.0, 1.0 - (current_value / baseline))
        pressure += scarcity * weight

    return pressure


def dump_default_world_map() -> str:
    return json.dumps(DEFAULT_WORLD_MAP.model_dump(mode="json"), indent=2)
