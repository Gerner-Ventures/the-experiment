"""Tests for ExperimentRunner, ConnectionManager, and experiment API routes."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.api.ws_manager import ConnectionManager
from app.engine.models import RoundResult, SimulationState
from app.engine.runner import ExperimentRunner


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_AGENTS = [
    {
        "id": str(i),
        "name": f"Agent-{chr(64 + i)}",
        "personality": ["cautious"],
        "personalityAxes": {
            "paranoia": 50,
            "empathy": 60,
            "dominance": 40,
            "impulsiveness": 30,
            "loyalty": 70,
            "ambition": 50,
        },
        "secretGoal": "Survive",
        "goalArchetype": "communal_survival",
        "llmModel": "openai/gpt-4o-mini",
    }
    for i in range(1, 7)
]


def _make_runner(*, use_mock: bool = True) -> ExperimentRunner:
    ws = ConnectionManager()
    return ExperimentRunner(ws, use_mock=use_mock)


def _create_experiment(runner: ExperimentRunner) -> SimulationState:
    return runner.create_experiment(
        name="Test Experiment",
        agents=SAMPLE_AGENTS,
        arc_id="lord_of_the_flies",
        total_rounds=5,
    )


# ---------------------------------------------------------------------------
# ExperimentRunner – direct unit tests
# ---------------------------------------------------------------------------


class TestExperimentRunner:
    def test_create_experiment(self) -> None:
        runner = _make_runner()
        state = _create_experiment(runner)

        assert state.experiment_name == "Test Experiment"
        assert state.total_rounds == 5
        assert state.current_round == 0
        assert state.status == "setup"
        assert len(state.agents) == 6
        assert state.experiment_id in runner._experiments

    def test_get_experiment(self) -> None:
        runner = _make_runner()
        state = _create_experiment(runner)

        found = runner.get_experiment(state.experiment_id)
        assert found is not None
        assert found.experiment_id == state.experiment_id

    def test_get_experiment_not_found(self) -> None:
        runner = _make_runner()
        assert runner.get_experiment("nonexistent-id") is None

    def test_start_experiment(self) -> None:
        runner = _make_runner()
        state = _create_experiment(runner)
        assert state.status == "setup"

        started = runner.start_experiment(state.experiment_id)
        assert started.status == "running"

    def test_pause_experiment(self) -> None:
        runner = _make_runner()
        state = _create_experiment(runner)
        runner.start_experiment(state.experiment_id)

        paused = runner.pause_experiment(state.experiment_id)
        assert paused.status == "paused"

    @pytest.mark.asyncio
    async def test_step_round_with_mock(self) -> None:
        runner = _make_runner(use_mock=True)
        state = _create_experiment(runner)
        runner.start_experiment(state.experiment_id)

        result = await runner.step_round(state.experiment_id)

        assert isinstance(result, RoundResult)
        assert result.round_number == 1
        assert 0 <= result.cooperation_ratio <= 1
        assert 0 <= result.threat_level <= 100
        assert len(result.phases) > 0

        # State should have advanced
        updated = runner.get_experiment(state.experiment_id)
        assert updated is not None
        assert updated.current_round == 1

    @pytest.mark.asyncio
    async def test_step_round_multiple(self) -> None:
        runner = _make_runner(use_mock=True)
        state = _create_experiment(runner)
        runner.start_experiment(state.experiment_id)

        r1 = await runner.step_round(state.experiment_id)
        r2 = await runner.step_round(state.experiment_id)

        assert r1.round_number == 1
        assert r2.round_number == 2

    @pytest.mark.asyncio
    async def test_experiment_completes_after_all_rounds(self) -> None:
        runner = _make_runner(use_mock=True)
        state = runner.create_experiment(
            name="Short",
            agents=SAMPLE_AGENTS,
            arc_id="lord_of_the_flies",
            total_rounds=2,
        )
        runner.start_experiment(state.experiment_id)

        await runner.step_round(state.experiment_id)
        await runner.step_round(state.experiment_id)

        final = runner.get_experiment(state.experiment_id)
        assert final is not None
        assert final.status == "completed"

    def test_agent_properties_mapped(self) -> None:
        runner = _make_runner()
        state = _create_experiment(runner)

        agent = state.agents[0]
        assert agent.agent_id == "1"
        assert agent.name == "Agent-A"
        assert agent.personality.axes.empathy == 60
        assert agent.personality.axes.dominance == 40
        assert agent.goal.archetype == "communal_survival"
        assert agent.goal.text == "Survive"
        assert agent.location == "town_square"

    def test_resources_initialized(self) -> None:
        runner = _make_runner()
        state = _create_experiment(runner)

        resources = state.world_state.resources
        assert resources.food > 0
        assert resources.water > 0
        assert resources.materials > 0
        assert resources.power > 0


# ---------------------------------------------------------------------------
# ConnectionManager – unit tests
# ---------------------------------------------------------------------------


class TestConnectionManager:
    @pytest.mark.asyncio
    async def test_connect_and_disconnect(self) -> None:
        mgr = ConnectionManager()
        ws = AsyncMock()
        ws.client_state = MagicMock()

        await mgr.connect("exp-1", ws)
        ws.accept.assert_awaited_once()
        assert mgr.has_connections("exp-1")

        mgr.disconnect("exp-1", ws)
        assert not mgr.has_connections("exp-1")

    @pytest.mark.asyncio
    async def test_disconnect_unknown_ws(self) -> None:
        mgr = ConnectionManager()
        ws = AsyncMock()
        # Should not raise
        mgr.disconnect("exp-1", ws)
        assert not mgr.has_connections("exp-1")

    @pytest.mark.asyncio
    async def test_broadcast_to_connected(self) -> None:
        from starlette.websockets import WebSocketState
        from app.schemas.ws_message import WSMessage
        from datetime import datetime, UTC

        mgr = ConnectionManager()
        ws = AsyncMock()
        ws.client_state = WebSocketState.CONNECTED

        await mgr.connect("exp-1", ws)

        msg = WSMessage(
            type="test_event",
            round=1,
            phase=None,
            timestamp=datetime.now(UTC),
            data={"key": "value"},
        )
        await mgr.broadcast("exp-1", msg)

        ws.send_json.assert_awaited_once()
        payload = ws.send_json.call_args[0][0]
        assert payload["type"] == "test_event"
        assert payload["data"]["key"] == "value"

    @pytest.mark.asyncio
    async def test_broadcast_no_connections(self) -> None:
        from app.schemas.ws_message import WSMessage
        from datetime import datetime, UTC

        mgr = ConnectionManager()
        msg = WSMessage(
            type="noop",
            round=1,
            phase=None,
            timestamp=datetime.now(UTC),
            data={},
        )
        # Should not raise
        await mgr.broadcast("no-such-experiment", msg)

    @pytest.mark.asyncio
    async def test_send_event(self) -> None:
        from starlette.websockets import WebSocketState

        mgr = ConnectionManager()
        ws = AsyncMock()
        ws.client_state = WebSocketState.CONNECTED

        await mgr.connect("exp-1", ws)
        await mgr.send_event("exp-1", "round_start", 1, {"round": 1})

        ws.send_json.assert_awaited_once()
        payload = ws.send_json.call_args[0][0]
        assert payload["type"] == "round_start"
        assert payload["round"] == 1

    @pytest.mark.asyncio
    async def test_broadcast_removes_dead_connections(self) -> None:
        from starlette.websockets import WebSocketState
        from app.schemas.ws_message import WSMessage
        from datetime import datetime, UTC

        mgr = ConnectionManager()

        good_ws = AsyncMock()
        good_ws.client_state = WebSocketState.CONNECTED

        bad_ws = AsyncMock()
        bad_ws.client_state = WebSocketState.CONNECTED
        bad_ws.send_json.side_effect = RuntimeError("connection lost")

        await mgr.connect("exp-1", good_ws)
        await mgr.connect("exp-1", bad_ws)
        assert len(mgr._connections["exp-1"]) == 2

        msg = WSMessage(
            type="test",
            round=1,
            phase=None,
            timestamp=datetime.now(UTC),
            data={},
        )
        await mgr.broadcast("exp-1", msg)

        # Dead connection should have been removed
        assert len(mgr._connections["exp-1"]) == 1
        good_ws.send_json.assert_awaited_once()


# ---------------------------------------------------------------------------
# Experiment API routes – integration tests via TestClient
# ---------------------------------------------------------------------------


@pytest.fixture()
def client():
    """Provide a TestClient wired to a fresh ExperimentRunner."""
    from app.main import app
    import app.main as main_module

    original_runner = main_module.experiment_runner
    test_runner = _make_runner(use_mock=True)
    main_module.experiment_runner = test_runner

    with TestClient(app) as c:
        yield c

    main_module.experiment_runner = original_runner


def _create_via_api(client: TestClient) -> dict:
    resp = client.post(
        "/experiments",
        json={
            "name": "API Test",
            "agents": SAMPLE_AGENTS,
            "arc_id": "lord_of_the_flies",
            "total_rounds": 5,
        },
    )
    assert resp.status_code == 201
    return resp.json()


class TestExperimentAPI:
    def test_create_experiment_via_api(self, client: TestClient) -> None:
        data = _create_via_api(client)

        assert "id" in data
        assert data["name"] == "API Test"
        assert data["status"] == "setup"
        assert data["totalRounds"] == 5
        assert data["currentRound"] == 0
        assert len(data["agents"]) == 6
        assert "resources" in data
        assert "arc" in data

    def test_get_experiment_via_api(self, client: TestClient) -> None:
        created = _create_via_api(client)
        exp_id = created["id"]

        resp = client.get(f"/experiments/{exp_id}")
        assert resp.status_code == 200

        data = resp.json()
        assert data["id"] == exp_id
        assert data["name"] == "API Test"

    def test_get_experiment_not_found(self, client: TestClient) -> None:
        resp = client.get("/experiments/does-not-exist")
        assert resp.status_code == 404

    def test_start_experiment_via_api(self, client: TestClient) -> None:
        created = _create_via_api(client)
        exp_id = created["id"]

        resp = client.post(f"/experiments/{exp_id}/start")
        assert resp.status_code == 200

        data = resp.json()
        assert data["status"] == "running"
        assert data["id"] == exp_id

    def test_start_not_found(self, client: TestClient) -> None:
        resp = client.post("/experiments/nope/start")
        assert resp.status_code == 404

    def test_pause_experiment_via_api(self, client: TestClient) -> None:
        created = _create_via_api(client)
        exp_id = created["id"]
        client.post(f"/experiments/{exp_id}/start")

        resp = client.post(f"/experiments/{exp_id}/pause")
        assert resp.status_code == 200
        assert resp.json()["status"] == "paused"

    def test_step_round_via_api(self, client: TestClient) -> None:
        created = _create_via_api(client)
        exp_id = created["id"]
        client.post(f"/experiments/{exp_id}/start")

        resp = client.post(f"/experiments/{exp_id}/step")
        assert resp.status_code == 200

        data = resp.json()
        assert data["round"] == 1
        assert "cooperationRatio" in data
        assert "threatLevel" in data
        assert "resources" in data
        assert "phases" in data
        assert len(data["phases"]) > 0

    def test_step_not_found(self, client: TestClient) -> None:
        resp = client.post("/experiments/nope/step")
        assert resp.status_code == 404

    def test_step_round_advances_state(self, client: TestClient) -> None:
        created = _create_via_api(client)
        exp_id = created["id"]
        client.post(f"/experiments/{exp_id}/start")

        client.post(f"/experiments/{exp_id}/step")
        resp = client.get(f"/experiments/{exp_id}")
        assert resp.json()["currentRound"] == 1

        client.post(f"/experiments/{exp_id}/step")
        resp = client.get(f"/experiments/{exp_id}")
        assert resp.json()["currentRound"] == 2

    def test_full_lifecycle(self, client: TestClient) -> None:
        """Create -> start -> step -> step -> verify round data."""
        created = _create_via_api(client)
        exp_id = created["id"]

        # Start
        resp = client.post(f"/experiments/{exp_id}/start")
        assert resp.json()["status"] == "running"

        # Step twice
        r1 = client.post(f"/experiments/{exp_id}/step").json()
        r2 = client.post(f"/experiments/{exp_id}/step").json()
        assert r1["round"] == 1
        assert r2["round"] == 2

        # Verify state
        state = client.get(f"/experiments/{exp_id}").json()
        assert state["currentRound"] == 2
        assert state["status"] == "running"
