from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from starlette.websockets import WebSocketState

from app.api.models import CreateExperimentRequest, EventLogItem
from app.api.runtime import ConnectionManager, ExperimentRuntime
from app.api.store import InMemoryExperimentStore
from app.core.config import Settings
from app.engine.models import ActionResolution, RoundResult
from app.gm.models import CrisisEvent, GMPlanData, GMPlanRecord, ResourceDelta
from app.tts import NarrationTTSService
from app.tts.models import NarrationAudioRequest, ProviderAudioStream


class _CountingStore(InMemoryExperimentStore):
    def __init__(self) -> None:
        super().__init__()
        self.list_logs_calls = 0

    async def list_logs(self, experiment_id: str) -> list[EventLogItem]:
        self.list_logs_calls += 1
        return await super().list_logs(experiment_id)


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


def _gm_plan(round_number: int) -> GMPlanRecord:
    return GMPlanRecord(
        status="applied",
        plan=GMPlanData(
            round=round_number,
            round_theme="Test pressure",
            reasoning="Keep the test deterministic.",
            crisis_event=CrisisEvent(
                type="social",
                description="A tense silence falls over the square.",
                severity="low",
            ),
            resource_modifiers=ResourceDelta(),
            narration="The town watches itself carefully.",
        ),
    )


class _FakeNarrationProvider:
    async def start_stream(self, request: NarrationAudioRequest) -> ProviderAudioStream:
        async def iterate() -> AsyncIterator[bytes]:
            yield b"audio"

        return ProviderAudioStream(
            content_type="audio/mpeg",
            request_id=f"req-{request.round_number}",
            stream=iterate(),
        )

    async def aclose(self) -> None:
        return None


@pytest.fixture()
def runtime_instance() -> ExperimentRuntime:
    return ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=NarrationTTSService(
            Settings(
                elevenlabs_api_key="test-key",
                elevenlabs_voice_id="voice-test",
                elevenlabs_model_id="model-test",
            ),
            provider=_FakeNarrationProvider(),
        ),
    )


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
    assert logs[0].data["resources"] == stored.world_state.resources.model_dump(mode="json")


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
async def test_build_round_summary_tolerates_action_records_for_unknown_agents(
    runtime_instance: ExperimentRuntime,
) -> None:
    state = await runtime_instance.create_experiment(_request())

    summary = runtime_instance._build_round_summary(
        state,
        RoundResult(
            round_number=1,
            gm_plan=_gm_plan(1),
            phases=[],
            cooperation_ratio=0.0,
            threat_level=state.world_state.threat_level,
            world_state=state.world_state,
            action_resolutions=[
                ActionResolution(
                    phase="morning",
                    agent_id="missing-agent",
                    agent_name="Ghost",
                    location="town_square",
                    requested_action_type="observe",
                    resolved_action_type="observe",
                    cooperation_intent="low",
                    goal_progress="I was never on the roster.",
                    summary="Ghost lingers at the edge of the round.",
                    suspicion_level=0.0,
                )
            ],
            created_at=datetime.now(UTC),
        ),
    )

    assert summary["goal_progress"][0]["agent_id"] == "missing-agent"
    assert summary["goal_progress"][0]["goal_text"] == ""
    assert summary["goal_progress"][0]["status"] == ""


@pytest.mark.asyncio
async def test_faction_analytics_tolerates_legacy_round_logs_without_kind(
    runtime_instance: ExperimentRuntime,
) -> None:
    state = await runtime_instance.create_experiment(_request())
    await runtime_instance.store.append_log(
        EventLogItem(
            id="legacy-round-end",
            experiment_id=state.experiment_id,
            round_number=1,
            phase="night",
            type="round_end",
            summary="Legacy faction snapshot.",
            data={
                "factions": [
                    {
                        "faction_id": "legacy-faction",
                        "name": "Unlabeled Circle",
                        "member_ids": ["a1"],
                        "pressure": 4.0,
                        "influence": 8.0,
                    }
                ]
            },
            timestamp=datetime.now(UTC),
        )
    )

    analytics = await runtime_instance.get_faction_analytics(state.experiment_id, state=state)

    assert analytics.timeline[0].faction_id == "legacy-faction"
    assert analytics.timeline[0].kind is None


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
async def test_replay_index_reuses_loaded_logs() -> None:
    store = _CountingStore()
    runtime = ExperimentRuntime(store=store)
    state = await runtime.create_experiment(_request())

    await store.append_log(
        EventLogItem(
            id="round-end",
            experiment_id=state.experiment_id,
            round_number=1,
            phase="round_end",
            type="round_end",
            summary="Round 1 concludes.",
            data={
                "summary": "Round 1 concludes.",
                "threat_level": 10.0,
                "resources": state.world_state.resources.model_dump(mode="json"),
                "cooperation": {"score": 0.5, "cooperative_actions": 1, "total_actions": 2},
                "betrayal_count": 0,
                "sabotage_count": 0,
                "gm": {"round_theme": "Pressure", "narration": "The town watches itself."},
                "factions": [],
                "suspicion": [],
            },
            timestamp=datetime.now(UTC),
        )
    )
    await store.record_round_result(
        state.experiment_id,
        RoundResult(
            round_number=1,
            gm_plan=_gm_plan(1),
            phases=[],
            cooperation_ratio=0.0,
            threat_level=10.0,
            world_state=state.world_state,
            action_resolutions=[],
            created_at=datetime.now(UTC),
        ),
    )

    replay = await runtime.get_replay_index(state.experiment_id)

    assert replay.rounds[0].round_number == 1
    assert store.list_logs_calls == 1


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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "socket_state",
    [WebSocketState.CONNECTING, WebSocketState.DISCONNECTED, WebSocketState.RESPONSE],
)
async def test_connection_manager_prunes_non_connected_sockets_before_sending(
    socket_state: WebSocketState,
) -> None:
    manager = ConnectionManager()
    live_socket = AsyncMock()
    live_socket.client_state = WebSocketState.CONNECTED
    non_connected_socket = AsyncMock()
    non_connected_socket.client_state = socket_state

    await manager.connect("exp-1", live_socket)
    await manager.connect("exp-1", non_connected_socket)
    await manager.broadcast("exp-1", {"type": "round_start"})

    live_socket.send_json.assert_awaited_once()
    non_connected_socket.send_json.assert_not_awaited()
    assert live_socket in manager.connections["exp-1"]
    assert non_connected_socket not in manager.connections["exp-1"]


@pytest.mark.asyncio
async def test_approve_gm_plan_emits_audio_status(runtime_instance: ExperimentRuntime) -> None:
    runtime_instance.connection_manager = AsyncMock()
    state = await runtime_instance.create_experiment(_request())

    applied = await runtime_instance.approve_gm_plan(state.experiment_id)
    await asyncio.sleep(0.01)

    sent_types = [
        call.args[1]["type"]
        for call in runtime_instance.connection_manager.broadcast.await_args_list
    ]
    assert applied.status == "applied"
    assert "gm_audio_status" in sent_types


@pytest.mark.asyncio
async def test_broadcast_narration_audio_status_is_noop_without_tts_service() -> None:
    runtime = ExperimentRuntime(store=InMemoryExperimentStore())
    runtime.connection_manager = AsyncMock()

    await runtime._broadcast_narration_audio_status_for_plan("exp-1", _gm_plan(1))

    runtime.connection_manager.broadcast.assert_not_awaited()
