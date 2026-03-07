from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.agents.models import AgentTurnResult
from app.api.runtime import runtime
from app.agents.service import AgentService
from app.main import app
from app.schemas.agent_decision import AgentDecision, DecisionAction

client = TestClient(app)


class _StubAgentService(AgentService):
    async def decide(self, context: object) -> AgentTurnResult:
        from app.agents.models import AgentContext

        agent_context = context if isinstance(context, AgentContext) else AgentContext.model_validate(context)
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


runtime.engine.agent_service = _StubAgentService()


def _payload() -> dict[str, Any]:
    return {
        "name": "Frontend Integration Trial",
        "total_rounds": 12,
        "auto_approve": False,
        "preset_arc_id": "slow_burn",
        "agents": [
            {
                "name": "Mara",
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


def test_create_get_and_step_experiment_flow() -> None:
    created = client.post("/experiments", json=_payload())
    assert created.status_code == 200
    experiment_id = created.json()["experiment_id"]

    gm_plan = client.get(f"/experiments/{experiment_id}/gm/plan")
    assert gm_plan.status_code == 200
    assert gm_plan.json()["status"] == "pending"

    approved = client.post(f"/experiments/{experiment_id}/gm/approve", json={})
    assert approved.status_code == 200
    assert approved.json()["status"] == "applied"

    stepped = client.post(f"/experiments/{experiment_id}/step")
    assert stepped.status_code == 200
    assert stepped.json()["round_result"]["round_number"] == 1

    fetched = client.get(f"/experiments/{experiment_id}")
    assert fetched.status_code == 200
    assert fetched.json()["current_round"] == 1


def test_log_endpoint_filters_and_paginates() -> None:
    created = client.post("/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]
    client.post(f"/experiments/{experiment_id}/gm/approve", json={})
    client.post(f"/experiments/{experiment_id}/step")

    log_response = client.get(f"/experiments/{experiment_id}/log", params={"limit": 5, "phase": "dawn"})
    assert log_response.status_code == 200
    body = log_response.json()
    assert body["limit"] == 5
    assert body["total"] >= 1
    assert all(item["phase"] == "dawn" for item in body["items"])


def test_websocket_connects_and_receives_initial_message() -> None:
    created = client.post("/experiments", json=_payload())
    experiment_id = created.json()["experiment_id"]

    with client.websocket_connect(f"/experiments/{experiment_id}/ws") as websocket:
        message = websocket.receive_json()
        assert message["type"] == "connected"
        assert message["experiment_id"] == experiment_id
