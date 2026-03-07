from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from starlette.websockets import WebSocketState

from app.api.models import CreateExperimentRequest
from app.api.runtime import ConnectionManager, ExperimentRuntime
from app.api.store import InMemoryExperimentStore


def _request() -> CreateExperimentRequest:
    return CreateExperimentRequest.model_validate(
        {
            "name": "Runtime Test",
            "total_rounds": 4,
            "agents": [
                {
                    "name": "Mara",
                    "character_id": "undertaker_01",
                    "personality": {
                        "axes": {
                            "paranoia": 72,
                            "empathy": 40,
                            "dominance": 58,
                            "impulsiveness": 61,
                            "loyalty": 44,
                            "ambition": 70,
                        },
                        "trait_tags": ["guarded", "curious", "scheming"],
                        "self_concept": "I am the only one asking the right questions.",
                    },
                    "goal": {
                        "archetype": "truth_revelation",
                        "text": "Figure out who is watching and force them to answer.",
                        "progress_signals": ["observer clues"],
                    },
                },
                {
                    "name": "Jon",
                    "character_id": "caretaker_01",
                    "personality": {
                        "axes": {
                            "paranoia": 35,
                            "empathy": 62,
                            "dominance": 44,
                            "impulsiveness": 39,
                            "loyalty": 75,
                            "ambition": 48,
                        },
                        "trait_tags": ["dutiful", "protective"],
                        "self_concept": "Someone has to hold things together.",
                    },
                    "goal": {
                        "archetype": "communal_survival",
                        "text": "Keep the town functional until rescue arrives.",
                        "progress_signals": ["resource stability"],
                    },
                },
            ],
        }
    )


@pytest.fixture()
def runtime_instance() -> ExperimentRuntime:
    return ExperimentRuntime(store=InMemoryExperimentStore())


@pytest.mark.asyncio
async def test_create_experiment_persists_initial_state_and_log(
    runtime_instance: ExperimentRuntime,
) -> None:
    state = await runtime_instance.create_experiment(_request())
    stored = await runtime_instance.get_state(state.experiment_id)
    logs, total = await runtime_instance.get_log(state.experiment_id, limit=10, offset=0)

    assert stored.experiment_id == state.experiment_id
    assert stored.experiment_name == "Runtime Test"
    assert stored.status == "setup"
    assert len(stored.agents) == 2
    assert total == 1
    assert logs[0].type == "experiment_created"


@pytest.mark.asyncio
async def test_start_and_pause_persist_state_and_logs(
    runtime_instance: ExperimentRuntime,
) -> None:
    state = await runtime_instance.create_experiment(_request())

    started = await runtime_instance.start(state.experiment_id)
    paused = await runtime_instance.pause(state.experiment_id)
    stored = await runtime_instance.get_state(state.experiment_id)
    logs, _ = await runtime_instance.get_log(state.experiment_id, limit=10, offset=0)

    assert started.status == "running"
    assert paused.status == "paused"
    assert stored.status == "paused"
    assert [item.type for item in logs] == [
        "experiment_created",
        "experiment_started",
        "experiment_paused",
    ]


@pytest.mark.asyncio
async def test_inject_observer_event_updates_plotlines_and_suspicion(
    runtime_instance: ExperimentRuntime,
) -> None:
    state = await runtime_instance.create_experiment(_request())

    updated = await runtime_instance.inject_observer_event(
        state.experiment_id, "The streetlights blinked in perfect sync."
    )
    await asyncio.sleep(0)

    stored = await runtime_instance.get_state(state.experiment_id)
    logs, total = await runtime_instance.get_log(
        state.experiment_id,
        limit=10,
        offset=0,
        event_type="observer_event",
    )

    assert updated.unresolved_plotlines == ["The streetlights blinked in perfect sync."]
    assert stored.unresolved_plotlines == ["The streetlights blinked in perfect sync."]
    assert all(agent.suspicion_level == 6.0 for agent in stored.agents)
    assert total == 1
    assert logs[0].summary == "The streetlights blinked in perfect sync."


@pytest.mark.asyncio
async def test_connection_manager_broadcasts_encoded_payload_to_all_connected_sockets() -> None:
    manager = ConnectionManager()
    first_socket = AsyncMock()
    first_socket.client_state = WebSocketState.CONNECTED
    second_socket = AsyncMock()
    second_socket.client_state = WebSocketState.CONNECTED

    await manager.connect("exp-1", first_socket)
    await manager.connect("exp-1", second_socket)
    await manager.broadcast(
        "exp-1",
        {"connected_at": datetime.now(UTC), "data": {"experiment_id": "exp-1"}},
    )

    first_socket.accept.assert_awaited_once()
    second_socket.accept.assert_awaited_once()
    first_socket.send_json.assert_awaited_once()
    second_socket.send_json.assert_awaited_once()

    payload = first_socket.send_json.call_args.args[0]
    assert isinstance(payload["connected_at"], str)
    assert payload["data"]["experiment_id"] == "exp-1"


@pytest.mark.asyncio
async def test_connection_manager_removes_dead_sockets_during_broadcast() -> None:
    manager = ConnectionManager()
    live_socket = AsyncMock()
    live_socket.client_state = WebSocketState.CONNECTED
    dead_socket = AsyncMock()
    dead_socket.client_state = WebSocketState.CONNECTED
    dead_socket.send_json.side_effect = RuntimeError("connection lost")

    await manager.connect("exp-1", live_socket)
    await manager.connect("exp-1", dead_socket)
    await manager.broadcast("exp-1", {"type": "round_start"})

    live_socket.send_json.assert_awaited_once()
    assert live_socket in manager.connections["exp-1"]
    assert dead_socket not in manager.connections["exp-1"]
