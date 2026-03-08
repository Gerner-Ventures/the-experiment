from __future__ import annotations

from app.actions import (
    ACTION_ALLOWED_LOCATION_TYPES,
    ACTION_CATALOG,
    ACTION_CONSEQUENCE_POOLS,
    ACTION_IDS,
    CONSEQUENCE_ACTION_IDS,
    CONSEQUENCE_SUSPICION_DELTAS,
    COOPERATIVE_ACTION_IDS,
    DECISION_ACTION_IDS,
    HOSTILE_ACTION_IDS,
    INTERACTION_ACTION_IDS,
    MOCK_COOPERATIVE_ACTION_IDS,
    MOCK_SELFISH_ACTION_IDS,
    RANGED_ACTION_IDS,
    SABOTAGE_ACTION_IDS,
    TERMINAL_ACTION_IDS,
    get_action,
)


def test_action_catalog_ids_are_unique_and_partitioned() -> None:
    assert len(ACTION_IDS) == len(set(ACTION_IDS))
    assert set(ACTION_IDS) == set(ACTION_CATALOG)
    assert set(DECISION_ACTION_IDS).isdisjoint(CONSEQUENCE_ACTION_IDS)
    assert set(DECISION_ACTION_IDS) | set(CONSEQUENCE_ACTION_IDS) == set(ACTION_IDS)
    assert set(CONSEQUENCE_ACTION_IDS).isdisjoint(COOPERATIVE_ACTION_IDS)


def test_consequence_mappings_only_reference_known_consequence_actions() -> None:
    consequence_ids = set(CONSEQUENCE_ACTION_IDS)
    for action_id, consequence_pool in ACTION_CONSEQUENCE_POOLS.items():
        assert consequence_pool
        assert get_action(action_id).kind == "decision"
        assert set(consequence_pool) <= consequence_ids


def test_only_consequence_actions_define_suspicion_deltas() -> None:
    assert set(CONSEQUENCE_SUSPICION_DELTAS) == set(CONSEQUENCE_ACTION_IDS)
    for action_id in ACTION_IDS:
        spec = get_action(action_id)
        if action_id in CONSEQUENCE_SUSPICION_DELTAS:
            assert spec.kind == "consequence"
        else:
            assert spec.suspicion_delta is None


def test_interaction_and_ranged_actions_are_tagged_consistently() -> None:
    assert set(RANGED_ACTION_IDS) <= set(INTERACTION_ACTION_IDS)
    for action_id in RANGED_ACTION_IDS:
        assert get_action(action_id).interaction_range is not None
    for action_id in INTERACTION_ACTION_IDS:
        spec = get_action(action_id)
        if spec.interaction_range is not None:
            assert action_id in RANGED_ACTION_IDS


def test_catalog_preserves_backend_runtime_groupings() -> None:
    assert set(COOPERATIVE_ACTION_IDS) == {
        "gather",
        "repair",
        "talk",
        "trade",
        "rest",
        "observe",
        "pray",
        "rally",
        "mourn",
        "self_sacrifice",
    }
    assert set(HOSTILE_ACTION_IDS) == {"accuse", "attack", "threaten", "stab", "shoot", "poison"}
    assert set(SABOTAGE_ACTION_IDS) == {"sabotage"}
    assert set(TERMINAL_ACTION_IDS) == {"self_sacrifice"}


def test_catalog_preserves_mock_brain_action_buckets() -> None:
    assert set(MOCK_COOPERATIVE_ACTION_IDS) == {
        "gather",
        "repair",
        "trade",
        "talk",
        "rest",
        "observe",
    }
    assert set(MOCK_SELFISH_ACTION_IDS) == {"hoard", "sabotage", "explore", "accuse"}


def test_catalog_preserves_backend_location_rules() -> None:
    assert ACTION_ALLOWED_LOCATION_TYPES["gather"] == frozenset({"farm", "water_source", "store"})
    assert ACTION_ALLOWED_LOCATION_TYPES["repair"] == frozenset(
        {"workshop", "meeting_hall", "boundary", "mystery"}
    )
    assert ACTION_ALLOWED_LOCATION_TYPES["hoard"] == frozenset(
        {"farm", "water_source", "store", "residence", "bar", "brothel"}
    )
    assert ACTION_ALLOWED_LOCATION_TYPES["vote"] == frozenset({"meeting_hall"})
