from app.world import (
    DEFAULT_WORLD_MAP,
    apply_resource_tick,
    build_default_world_state,
    calculate_threat_level,
    create_world_snapshot,
    restore_world_snapshot,
)
from app.world.models import ResourceState, ResourceTick


def test_default_world_map_contains_required_locations() -> None:
    location_ids = {location.id for location in DEFAULT_WORLD_MAP.locations}
    assert DEFAULT_WORLD_MAP.width == 20
    assert DEFAULT_WORLD_MAP.height == 20
    assert len(DEFAULT_WORLD_MAP.tiles) == 400
    assert {
        "general_store",
        "bar",
        "brothel",
        "well",
        "town_hall",
        "workshop",
        "farm",
        "perimeter_fence",
        "locked_building",
    }.issubset(location_ids)


def test_resource_tick_keeps_water_stable_but_degrades_power_and_materials() -> None:
    current = ResourceState(food=24.0, water=30.0, materials=14.0, power=10.0)
    tick = ResourceTick(
        location_modifiers={"water": 0.5},
        crisis_modifiers={"power": -0.6},
        action_modifiers={"materials": -0.4},
    )

    updated = apply_resource_tick(current, tick)

    assert updated.water == 29.5
    assert updated.food == 22.6
    assert updated.materials == 11.8
    assert updated.power == 7.2


def test_threat_prefers_systemic_inputs() -> None:
    calm = calculate_threat_level(
        ResourceState(food=20.0, water=28.0, materials=12.0, power=8.0),
        cooperation_ratio=0.9,
        crisis_severity=0.1,
    )
    collapse = calculate_threat_level(
        ResourceState(food=4.0, water=24.0, materials=1.0, power=0.0),
        cooperation_ratio=0.15,
        crisis_severity=0.6,
    )

    assert calm < collapse
    assert collapse > 70


def test_world_snapshot_round_trip() -> None:
    state = build_default_world_state(round_number=3)
    state.location_occupancy["town_hall"] = ["agent-1", "agent-2"]

    snapshot = create_world_snapshot(state)
    restored = restore_world_snapshot(snapshot)

    assert restored == state
