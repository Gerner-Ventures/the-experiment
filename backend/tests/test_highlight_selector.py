from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.api.models import EventLogItem, HighlightPage
from app.highlights import HighlightSelector


def _event(
    *,
    event_id: str,
    event_type: str,
    minutes: int,
    round_number: int | None = None,
    phase: str | None = None,
    data: dict | None = None,
    summary: str = "",
) -> EventLogItem:
    return EventLogItem(
        id=event_id,
        experiment_id="exp-1",
        round_number=round_number,
        phase=phase,
        type=event_type,
        summary=summary or event_id,
        data=data or {},
        timestamp=datetime(2026, 3, 7, 12, 0, tzinfo=UTC) + timedelta(minutes=minutes),
    )


def test_selector_returns_empty_list_for_empty_logs() -> None:
    selector = HighlightSelector()

    assert selector.select([], scope="game") == []


def test_selector_requires_round_number_for_round_scope() -> None:
    selector = HighlightSelector()

    with pytest.raises(ValueError, match="round_number is required"):
        selector.select([], scope="round")


def test_highlight_page_rejects_invalid_scope_round_number_combinations() -> None:
    with pytest.raises(ValueError, match="round_number is required"):
        HighlightPage(scope="round", items=[])

    with pytest.raises(ValueError, match="round_number must be omitted"):
        HighlightPage(scope="game", round_number=1, items=[])


def test_round_one_resource_swing_uses_experiment_initial_resources() -> None:
    selector = HighlightSelector()
    logs = [
        _event(
            event_id="created",
            event_type="experiment_created",
            minutes=0,
            data={"resources": {"food": 5.0, "water": 5.0, "materials": 5.0, "power": 5.0}},
        ),
        _event(
            event_id="round-1",
            event_type="round_end",
            round_number=1,
            phase="round_end",
            minutes=1,
            data={
                "resources": {"food": 5.0, "water": 5.0, "materials": 5.0, "power": 5.0},
                "factions": [],
                "suspicion": [],
            },
        ),
    ]

    highlights = selector.select(logs, scope="game")

    assert all(item.category != "resource_swing" for item in highlights)


def test_selector_uses_action_type_as_resolved_action_fallback() -> None:
    selector = HighlightSelector()
    logs = [
        _event(
            event_id="action",
            event_type="agent_action",
            round_number=1,
            phase="afternoon",
            minutes=0,
            summary="Mara sabotages the radio.",
            data={"requested_action_type": "observe", "action_type": "sabotage"},
        )
    ]

    highlights = selector.select(logs, scope="game")

    assert len(highlights) == 1
    assert highlights[0].category == "betrayal"


def test_selector_respects_resource_and_suspicion_thresholds() -> None:
    selector = HighlightSelector()
    logs = [
        _event(
            event_id="created",
            event_type="experiment_created",
            minutes=0,
            data={"resources": {"food": 10.0, "water": 10.0, "materials": 10.0, "power": 10.0}},
        ),
        _event(
            event_id="round-1",
            event_type="round_end",
            round_number=1,
            phase="round_end",
            minutes=1,
            data={
                "resources": {"food": 9.5, "water": 10.4, "materials": 10.0, "power": 10.0},
                "factions": [],
                "suspicion": [{"agent_id": "a1", "agent_name": "Mara", "suspicion_level": 10.0}],
            },
        ),
        _event(
            event_id="round-2",
            event_type="round_end",
            round_number=2,
            phase="round_end",
            minutes=2,
            data={
                "resources": {"food": 9.0, "water": 10.0, "materials": 10.0, "power": 10.0},
                "factions": [],
                "suspicion": [{"agent_id": "a1", "agent_name": "Mara", "suspicion_level": 17.9}],
            },
        ),
    ]

    highlights = selector.select(logs, scope="game")

    assert all(item.category != "resource_swing" for item in highlights)
    assert all(item.category != "suspicion_spike" for item in highlights)


def test_selector_caps_scores_for_large_swings_and_spikes() -> None:
    selector = HighlightSelector()
    logs = [
        _event(
            event_id="created",
            event_type="experiment_created",
            minutes=0,
            data={"resources": {"food": 20.0, "water": 20.0, "materials": 20.0, "power": 20.0}},
        ),
        _event(
            event_id="round-1",
            event_type="round_end",
            round_number=1,
            phase="round_end",
            minutes=1,
            data={
                "resources": {"food": 0.0, "water": 20.0, "materials": 20.0, "power": 20.0},
                "factions": [],
                "suspicion": [{"agent_id": "a1", "agent_name": "Mara", "suspicion_level": 5.0}],
            },
        ),
        _event(
            event_id="round-2",
            event_type="round_end",
            round_number=2,
            phase="round_end",
            minutes=2,
            data={
                "resources": {"food": 0.0, "water": 20.0, "materials": 20.0, "power": 20.0},
                "factions": [],
                "suspicion": [{"agent_id": "a1", "agent_name": "Mara", "suspicion_level": 55.0}],
            },
        ),
    ]

    highlights = selector.select(logs, scope="game")
    by_category = {item.category: item for item in highlights}

    assert by_category["resource_swing"].score == 7.4
    assert by_category["suspicion_spike"].score == 7.0
