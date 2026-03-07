from __future__ import annotations

from collections.abc import Generator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agents.models import AgentTurnResult
from app.agents.service import AgentService
from app.api.runtime import ExperimentRuntime
from app.api.store import InMemoryExperimentStore
from app.core.config import Settings
from app.core.runtime_factory import build_runtime
from app.llm import UsageTracker
from app.llm.models import LLMUsage, UsageRecord
from app.main import create_app
from app.schemas.agent_decision import AgentDecision, DecisionAction

API_PREFIX = "/api"


class _StubAgentService(AgentService):
    async def decide(self, context: object) -> AgentTurnResult:
        from app.agents.models import AgentContext

        agent_context = (
            context if isinstance(context, AgentContext) else AgentContext.model_validate(context)
        )
        return AgentTurnResult(
            decision=AgentDecision(
                inner_thought="I should keep the town stable.",
                suspicion=None,
                action=DecisionAction(type="observe", target="town_hall", location="town_hall"),
                dialogue=None,
                goal_progress="Holding position.",
                cooperation_intent="medium",
            ),
            updated_memory=agent_context.memory,
            suspicion_level=agent_context.suspicion_level,
            prompt="stub",
        )


class _ScriptedAgentService(AgentService):
    def __init__(self, scripts: dict[str, list[dict[str, str | None]]]) -> None:
        super().__init__()
        self.scripts = scripts
        self.calls: dict[str, int] = {}

    async def decide(self, context: object) -> AgentTurnResult:
        from app.agents.models import AgentContext

        agent_context = (
            context if isinstance(context, AgentContext) else AgentContext.model_validate(context)
        )
        index = self.calls.get(agent_context.name, 0)
        script = self.scripts[agent_context.name]
        current = script[min(index, len(script) - 1)]
        self.calls[agent_context.name] = index + 1
        return AgentTurnResult(
            decision=AgentDecision(
                inner_thought=str(current.get("inner_thought") or "I have a plan."),
                suspicion=None,
                action=DecisionAction(
                    type=str(current["action_type"]),
                    target=current.get("target"),
                    location=current.get("location"),
                ),
                dialogue=None,
                goal_progress=str(current.get("goal_progress") or "No change."),
                cooperation_intent=str(current.get("cooperation_intent") or "medium"),
            ),
            updated_memory=agent_context.memory,
            suspicion_level=agent_context.suspicion_level,
            prompt="scripted",
        )


@pytest.fixture()
def runtime() -> ExperimentRuntime:
    runtime, _ = build_runtime(
        Settings(backend_runtime_mode="smoke_mock"),
        store=InMemoryExperimentStore(),
    )
    runtime.engine.agent_service = _StubAgentService()
    gm_tracker = UsageTracker()
    if not hasattr(runtime.gm_service, "llm_service"):
        runtime.gm_service.llm_service = SimpleNamespace(client=SimpleNamespace(tracker=gm_tracker))
    else:
        runtime.gm_service.llm_service.client.tracker = gm_tracker
    if not hasattr(runtime.engine.gm_service, "llm_service"):
        runtime.engine.gm_service.llm_service = SimpleNamespace(
            client=SimpleNamespace(tracker=gm_tracker)
        )
    else:
        runtime.engine.gm_service.llm_service.client.tracker = gm_tracker
    return runtime


@pytest.fixture()
def client(runtime: ExperimentRuntime) -> Generator[TestClient, None, None]:
    app = create_app(runtime=runtime)
    with TestClient(app) as test_client:
        yield test_client


def _payload() -> dict[str, Any]:
    return {
        "name": "Frontend Integration Trial",
        "total_rounds": 12,
        "auto_approve": False,
        "preset_arc_id": "slow_burn",
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


def test_create_get_and_step_experiment_flow(client: TestClient) -> None:
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    assert created.status_code == 200
    experiment_id = created.json()["experiment_id"]
    assert created.json()["agents"][0]["character_id"] == "undertaker_01"
    assert created.json()["agents"][0]["status"] == "idle"

    gm_plan = client.get(f"{API_PREFIX}/experiments/{experiment_id}/gm/plan")
    assert gm_plan.status_code == 200
    assert gm_plan.json()["status"] == "pending"

    approved = client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})
    assert approved.status_code == 200
    assert approved.json()["status"] == "applied"

    stepped = client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")
    assert stepped.status_code == 200
    assert stepped.json()["status"] == "step_started"
    assert stepped.json()["round_number"] == 1
    assert stepped.json()["experiment_id"] == experiment_id


def test_start_and_pause_routes_update_experiment_status(client: TestClient) -> None:
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]

    started = client.post(f"{API_PREFIX}/experiments/{experiment_id}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "running"

    paused = client.post(f"{API_PREFIX}/experiments/{experiment_id}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    fetched = client.get(f"{API_PREFIX}/experiments/{experiment_id}")
    assert fetched.status_code == 200
    assert fetched.json()["status"] == "paused"
def test_log_endpoint_filters_and_paginates(client: TestClient) -> None:
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")

    log_response = client.get(
        f"{API_PREFIX}/experiments/{experiment_id}/log", params={"limit": 5, "phase": "dawn"}
    )
    assert log_response.status_code == 200
    body = log_response.json()
    assert body["limit"] == 5
    assert body["total"] >= 1
    assert all(item["phase"] == "dawn" for item in body["items"])


def test_websocket_connects_and_receives_initial_message(client: TestClient) -> None:
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]

    with client.websocket_connect(f"{API_PREFIX}/experiments/{experiment_id}/ws") as websocket:
        message = websocket.receive_json()
        assert message["type"] == "connected"
        assert message["data"]["experiment_id"] == experiment_id


def test_websocket_emits_granular_round_messages(client: TestClient) -> None:
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})

    with client.websocket_connect(f"{API_PREFIX}/experiments/{experiment_id}/ws") as websocket:
        websocket.receive_json()
        stepped = client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")
        assert stepped.status_code == 200

        seen_types: set[str] = set()
        required = {
            "round_start",
            "gm_plan",
            "crisis_event",
            "agent_action",
            "resource_update",
            "threat_update",
            "round_end",
        }
        for _ in range(40):
            message = websocket.receive_json()
            seen_types.add(message["type"])
            if required <= seen_types:
                break

        assert required <= seen_types


def test_analytics_and_replay_endpoints_return_round_data(client: TestClient) -> None:
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")

    summary = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/summary")
    assert summary.status_code == 200
    assert summary.json()["rounds_completed"] == 1
    assert summary.json()["cooperation_score"] > 0

    replay = client.get(f"{API_PREFIX}/experiments/{experiment_id}/replay")
    assert replay.status_code == 200
    assert replay.json()["rounds"][0]["round_number"] == 1
    assert "cooperation_score" in replay.json()["rounds"][0]

    snapshot = client.get(f"{API_PREFIX}/experiments/{experiment_id}/rounds/1/snapshot")
    assert snapshot.status_code == 200
    assert snapshot.json()["round_number"] == 1
    assert snapshot.json()["events"]

    highlights = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/highlights")
    assert highlights.status_code == 200
    assert highlights.json()["items"]
    assert highlights.json()["items"][0]["category"] == "crisis_event"


def test_derived_round_logs_are_persisted(client: TestClient) -> None:
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")

    agent_actions = client.get(
        f"{API_PREFIX}/experiments/{experiment_id}/log",
        params={"event_type": "agent_action"},
    )
    assert agent_actions.status_code == 200
    assert agent_actions.json()["total"] > 0

    crisis_events = client.get(
        f"{API_PREFIX}/experiments/{experiment_id}/log",
        params={"event_type": "crisis_event"},
    )
    assert crisis_events.status_code == 200
    assert crisis_events.json()["total"] == 1

    round_end = client.get(
        f"{API_PREFIX}/experiments/{experiment_id}/log",
        params={"event_type": "round_end"},
    )
    assert round_end.status_code == 200
    assert round_end.json()["total"] == 1


def test_report_grade_analytics_use_resolved_action_outcomes(
    client: TestClient, runtime: ExperimentRuntime
) -> None:
    runtime.engine.agent_service = _ScriptedAgentService(
        {
            "Mara": [
                {
                    "action_type": "accuse",
                    "location": "unknown_place",
                    "goal_progress": "I pushed too hard and got nowhere.",
                    "cooperation_intent": "low",
                },
                {
                    "action_type": "observe",
                    "goal_progress": "I recovered but still found no real lead.",
                    "cooperation_intent": "medium",
                },
                {
                    "action_type": "observe",
                    "goal_progress": "I finished the round empty-handed.",
                    "cooperation_intent": "medium",
                },
            ],
            "Jon": [
                {
                    "action_type": "observe",
                    "goal_progress": "I took one step closer to holding the line.",
                    "cooperation_intent": "medium",
                },
                {
                    "action_type": "observe",
                    "goal_progress": "I took one step closer to holding the line.",
                    "cooperation_intent": "medium",
                },
                {
                    "action_type": "observe",
                    "goal_progress": "I took one step closer to holding the line.",
                    "cooperation_intent": "medium",
                },
            ],
        }
    )
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")

    summary = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/summary")
    assert summary.status_code == 200
    assert summary.json()["cooperation_score"] == 1.0

    log_response = client.get(
        f"{API_PREFIX}/experiments/{experiment_id}/log",
        params={"event_type": "agent_action"},
    )
    assert log_response.status_code == 200
    action_items = log_response.json()["items"]
    assert action_items
    assert any(item["data"]["requested_action_type"] == "accuse" for item in action_items)
    assert all(item["data"]["resolved_action_type"] == "observe" for item in action_items)

    rounds = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/rounds")
    assert rounds.status_code == 200
    assert rounds.json()["items"][0]["cooperation_score"] == 1.0
    assert rounds.json()["items"][0]["total_actions"] == len(action_items)

    goals = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/goals")
    assert goals.status_code == 200
    goal_items = {item["agent_name"]: item for item in goals.json()["items"]}
    assert len(goal_items) == 2
    assert len(goal_items["Mara"]["progress_history"]) == 3
    assert (
        goal_items["Mara"]["progress_history"][0]["progress"]
        == "I pushed too hard and got nowhere."
    )
    assert goal_items["Mara"]["outcome"] == "unknown"
    assert goal_items["Jon"]["outcome"] == "partial"

    suspicion = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/suspicion")
    assert suspicion.status_code == 200
    assert len(suspicion.json()["heatmap"]) == 2
    suspicion_agents = {item["agent_name"]: item for item in suspicion.json()["agents"]}
    assert set(suspicion_agents) == {"Jon", "Mara"}
    assert "agent_id" not in suspicion_agents["Mara"]["points"][0]
    assert suspicion_agents["Mara"]["points"][0]["round_number"] == 1

    gm = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/gm")
    assert gm.status_code == 200
    assert gm.json()["items"][0]["round_number"] == 1
    assert gm.json()["items"][0]["round_theme"]
    assert gm.json()["items"][0]["narration"]
def test_goal_analytics_preserves_chronological_progress_for_multi_action_agents(
    client: TestClient, runtime: ExperimentRuntime
) -> None:
    runtime.engine.agent_service = _ScriptedAgentService(
        {
            "Mara": [
                {
                    "action_type": "accuse",
                    "location": "unknown_place",
                    "goal_progress": "I pushed too hard and got nowhere.",
                    "cooperation_intent": "low",
                },
                {
                    "action_type": "observe",
                    "goal_progress": "I watched the others settle.",
                    "cooperation_intent": "medium",
                },
                {
                    "action_type": "observe",
                    "goal_progress": "I kept my counsel through the afternoon.",
                    "cooperation_intent": "medium",
                },
            ],
            "Jon": [
                {
                    "action_type": "observe",
                    "goal_progress": "I kept watch.",
                    "cooperation_intent": "medium",
                }
            ],
        }
    )
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")

    goals = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/goals")
    assert goals.status_code == 200
    mara = next(item for item in goals.json()["items"] if item["agent_name"] == "Mara")
    assert mara["progress_history"][0]["requested_action_type"] == "accuse"
    assert mara["progress_history"][0]["summary"]
def test_goal_analytics_uses_unknown_when_progress_text_has_no_signal(
    client: TestClient, runtime: ExperimentRuntime
) -> None:
    runtime.engine.agent_service = _ScriptedAgentService(
        {
            "Mara": [
                {
                    "action_type": "observe",
                    "goal_progress": "I waited in silence.",
                    "cooperation_intent": "medium",
                }
            ],
            "Jon": [
                {
                    "action_type": "observe",
                    "goal_progress": "I held still and listened.",
                    "cooperation_intent": "medium",
                }
            ],
        }
    )
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")

    goals = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/goals")
    assert goals.status_code == 200
    assert all(item["outcome"] == "unknown" for item in goals.json()["items"])
def test_betrayal_and_faction_analytics_expose_timeline_data(
    client: TestClient, runtime: ExperimentRuntime
) -> None:
    runtime.engine.agent_service = _ScriptedAgentService(
        {
            "Mara": [
                {
                    "action_type": "sabotage",
                    "goal_progress": "I finally made the town bend around me.",
                    "cooperation_intent": "low",
                }
            ],
            "Jon": [
                {
                    "action_type": "observe",
                    "goal_progress": "I kept watch and tracked the fallout.",
                    "cooperation_intent": "medium",
                }
            ],
        }
    )
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/gm/approve", json={})
    client.post(f"{API_PREFIX}/experiments/{experiment_id}/step")

    betrayals = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/betrayals")
    assert betrayals.status_code == 200
    assert any(item["category"] == "sabotage" for item in betrayals.json()["items"])

    rounds = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/rounds")
    assert rounds.status_code == 200
    assert rounds.json()["items"][0]["sabotage_count"] >= 1

    factions = client.get(f"{API_PREFIX}/experiments/{experiment_id}/analytics/factions")
    assert factions.status_code == 200
    assert "timeline" in factions.json()
    assert "membership_changes" in factions.json()
def test_usage_and_prompt_trace_endpoints_group_records(
    client: TestClient, runtime: ExperimentRuntime
) -> None:
    created = client.post(f"{API_PREFIX}/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    runtime.gm_service.llm_service.client.tracker.record(
        UsageRecord(
            role="gm",
            model="openai/gpt-4o-mini",
            provider="openai",
            experiment_id=experiment_id,
            round_number=1,
            prompt_messages=[{"role": "system", "content": "You are the GM."}],
            response_content='{"round_theme":"Pressure builds"}',
            parsed_response={"round_theme": "Pressure builds"},
            usage=LLMUsage(
                prompt_tokens=20,
                completion_tokens=10,
                total_tokens=30,
                cost_usd=0.002,
            ),
        )
    )

    usage = client.get(f"{API_PREFIX}/experiments/{experiment_id}/usage")
    assert usage.status_code == 200
    assert usage.json()["summary"]["total_tokens"] == 30
    assert usage.json()["by_role"][0]["key"] == "gm"

    traces = client.get(f"{API_PREFIX}/experiments/{experiment_id}/usage/traces")
    assert traces.status_code == 200
    assert traces.json()["total"] == 1
    assert traces.json()["items"][0]["response_content"] == '{"round_theme":"Pressure builds"}'
