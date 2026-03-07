from __future__ import annotations

import pytest
from typing import cast

from app.agents.models import (
    AgentMemoryState,
    AgentTurnResult,
    PersonalityAxes,
    PersonalityProfile,
    SecretGoal,
)
from app.agents.service import AgentService
from app.engine import EngineAgentState, SimulationEngine, SimulationState
from app.gm import get_preset_arc
from app.schemas.agent_decision import AgentDecision, DecisionAction, DecisionActionType
from app.world import build_default_world_state


class _StubAgentService(AgentService):
    def __init__(self, scripted_actions: dict[str, list[tuple[str, str | None]]]) -> None:
        super().__init__()
        self.scripted_actions = scripted_actions
        self.calls: dict[str, int] = {agent_id: 0 for agent_id in scripted_actions}

    async def decide(self, context: object) -> AgentTurnResult:
        from app.agents.models import AgentContext

        agent_context = cast(AgentContext, context)
        index = self.calls[agent_context.agent_id]
        self.calls[agent_context.agent_id] += 1
        action_type, location = self.scripted_actions[agent_context.agent_id][index]
        return AgentTurnResult(
            decision=AgentDecision(
                inner_thought="A choice is made.",
                suspicion="The town is slightly off." if action_type == "explore" else None,
                action=DecisionAction(
                    type=cast(DecisionActionType, action_type),
                    target=location or "well",
                    location=location,
                ),
                dialogue=None,
                goal_progress="Incremental movement.",
                cooperation_intent="low"
                if action_type in {"hoard", "sabotage", "explore"}
                else "medium",
            ),
            updated_memory=agent_context.memory,
            suspicion_level=agent_context.suspicion_level,
            prompt="stub",
        )


def _agent(agent_id: str, name: str, location: str) -> EngineAgentState:
    return EngineAgentState(
        agent_id=agent_id,
        name=name,
        personality=PersonalityProfile(
            axes=PersonalityAxes(
                paranoia=50,
                empathy=50,
                dominance=50,
                impulsiveness=50,
                loyalty=50,
                ambition=50,
            ),
            trait_tags=["guarded", "curious"],
            self_concept="I am here.",
        ),
        goal=SecretGoal(archetype="truth_revelation", text="Figure out what this place is."),
        memory=AgentMemoryState(),
        location=location,
        relationships={},
        llm_model="openai/gpt-4o-mini",
    )


def _state() -> SimulationState:
    return SimulationState(
        experiment_id="exp-1",
        experiment_name="Greywater Trial",
        total_rounds=15,
        current_round=0,
        status="running",
        auto_approve=True,
        arc=get_preset_arc("slow_burn"),
        world_state=build_default_world_state(),
        agents=[
            _agent("a1", "Mara", "well"),
            _agent("a2", "Jon", "well"),
            _agent("a3", "Eli", "workshop"),
        ],
    )


@pytest.mark.asyncio
async def test_engine_runs_all_six_phases() -> None:
    service = _StubAgentService(
        {
            "a1": [("gather", "well"), ("talk", "bar"), ("repair", "workshop")],
            "a2": [("gather", "well"), ("observe", "town_hall"), ("hoard", "well")],
            "a3": [("repair", "workshop"), ("explore", "perimeter_fence"), ("repair", "workshop")],
        }
    )
    engine = SimulationEngine(agent_service=service, random_seed=3)

    result = await engine.run_round(_state())

    assert [phase.phase for phase in result.phases] == [
        "gm_plan",
        "dawn",
        "morning",
        "midday",
        "afternoon",
        "night",
    ]
    assert result.round_number == 1
    assert result.gm_plan.status == "applied"


@pytest.mark.asyncio
async def test_engine_creates_conflicts_under_simultaneous_pressure() -> None:
    service = _StubAgentService(
        {
            "a1": [("gather", "well"), ("gather", "well"), ("hoard", "well")],
            "a2": [("gather", "well"), ("gather", "well"), ("hoard", "well")],
            "a3": [("gather", "well"), ("observe", "bar"), ("repair", "workshop")],
        }
    )
    engine = SimulationEngine(agent_service=service, random_seed=2)

    result = await engine.run_round(_state())

    morning_conflicts = result.phases[2].conflicts
    afternoon_conflicts = result.phases[4].conflicts
    assert morning_conflicts or afternoon_conflicts
    assert any(
        conflict.location == "well" for conflict in [*morning_conflicts, *afternoon_conflicts]
    )


@pytest.mark.asyncio
async def test_engine_updates_threat_and_cooperation() -> None:
    service = _StubAgentService(
        {
            "a1": [("repair", "workshop"), ("talk", "bar"), ("repair", "workshop")],
            "a2": [("gather", "farm"), ("observe", "town_hall"), ("hoard", "well")],
            "a3": [("repair", "workshop"), ("talk", "town_hall"), ("repair", "workshop")],
        }
    )
    engine = SimulationEngine(agent_service=service, random_seed=4)

    result = await engine.run_round(_state())

    assert 0 <= result.cooperation_ratio <= 1
    assert 0 <= result.threat_level <= 100
    assert result.world_state.resources.power >= 0
