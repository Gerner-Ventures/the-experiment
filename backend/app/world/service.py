from __future__ import annotations

import json
from collections import deque
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.world.models import ResourceName, ResourceState, ResourceTick, WorldMap, WorldState

WORLD_DIR = Path(__file__).resolve().parent
DEFAULT_WORLD_MAP_PATH = WORLD_DIR / "data" / "default_town.json"


def load_default_world_map() -> WorldMap:
    return WorldMap.model_validate_json(DEFAULT_WORLD_MAP_PATH.read_text())


DEFAULT_WORLD_MAP = load_default_world_map()
DEFAULT_SPAWN_TILE = (10, 9)


@lru_cache(maxsize=1)
def _walkable_tiles() -> set[tuple[int, int]]:
    return {
        (tile.x, tile.y)
        for tile in DEFAULT_WORLD_MAP.tiles
        if tile.walkable
    }


@lru_cache(maxsize=1)
def _tile_location_ids() -> dict[tuple[int, int], str]:
    return {
        (tile.x, tile.y): tile.location_id
        for tile in DEFAULT_WORLD_MAP.tiles
        if tile.location_id is not None
    }


@lru_cache(maxsize=1)
def _locations_by_id() -> dict[str, object]:
    return {location.id: location for location in DEFAULT_WORLD_MAP.locations}


@lru_cache(maxsize=None)
def _location_entry_tiles(location_id: str) -> frozenset[tuple[int, int]]:
    if location_id == "town_square":
        return frozenset({DEFAULT_SPAWN_TILE})
    if location_id == "perimeter_fence":
        return frozenset(
            {
            (tile.x, tile.y)
            for tile in DEFAULT_WORLD_MAP.tiles
            if tile.walkable
            and (
                tile.x in {1, DEFAULT_WORLD_MAP.width - 2}
                or tile.y in {1, DEFAULT_WORLD_MAP.height - 2}
            )
            }
        )
    return frozenset(
        {
            (tile.x, tile.y)
            for tile in DEFAULT_WORLD_MAP.tiles
            if tile.walkable and tile.location_id == location_id
        }
    )


def resolve_spawn_tile(location_id: str | None) -> tuple[int, int]:
    candidate_location = location_id or "town_square"
    tiles = _location_entry_tiles(candidate_location)
    if not tiles:
        return DEFAULT_SPAWN_TILE
    return min(tiles, key=lambda tile: (tile[1], tile[0]))


def resolve_location_target(location_id: str | None) -> set[tuple[int, int]]:
    if location_id is None:
        return set()
    return set(_location_entry_tiles(location_id))


def get_location_type(location_id: str | None) -> str | None:
    if location_id is None:
        return None
    location = _locations_by_id().get(location_id)
    return getattr(location, "type", None)


def tile_distance(a: tuple[int, int], b: tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def step_toward(
    start: tuple[int, int],
    goals: set[tuple[int, int]],
    *,
    max_steps: int,
) -> list[tuple[int, int]]:
    if start in goals or max_steps <= 0:
        return [start]

    walkable = _walkable_tiles()
    frontier: deque[tuple[int, int]] = deque([start])
    came_from: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
    found_goal: tuple[int, int] | None = None

    while frontier:
        current = frontier.popleft()
        if current in goals:
            found_goal = current
            break
        for neighbor in get_adjacent_walkable_tiles(current):
            if neighbor not in walkable or neighbor in came_from:
                continue
            came_from[neighbor] = current
            frontier.append(neighbor)

    if found_goal is None:
        return [start]

    path: list[tuple[int, int]] = []
    cursor: tuple[int, int] | None = found_goal
    while cursor is not None:
        path.append(cursor)
        cursor = came_from[cursor]
    path.reverse()
    capped = path[: max_steps + 1]
    return capped or [start]


def get_adjacent_walkable_tiles(tile: tuple[int, int]) -> list[tuple[int, int]]:
    x, y = tile
    neighbors = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    walkable = _walkable_tiles()
    return [neighbor for neighbor in neighbors if neighbor in walkable]


@lru_cache(maxsize=None)
def location_label_for_tile(tile: tuple[int, int]) -> str:
    location_id = _tile_location_ids().get(tile)
    if location_id is not None:
        return location_id
    if tile_distance(tile, DEFAULT_SPAWN_TILE) <= 2:
        return "town_square"

    locations = [
        (location.id, resolve_spawn_tile(location.id))
        for location in DEFAULT_WORLD_MAP.locations
        if location.id != "perimeter_fence"
    ]
    return min(locations, key=lambda item: tile_distance(tile, item[1]))[0]


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

    return round(
        min(100.0, baseline + scarcity_pressure + cooperation_pressure + crisis_pressure), 2
    )


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
