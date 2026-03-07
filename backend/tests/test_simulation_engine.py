from __future__ import annotations

import pytest
from typing import cast

from app.agents.models import (
    AgentMemoryState,
    AgentTurnResult,
    PersonalityAxes,
    PersonalityProfile,
    RelationshipMemory,
    SecretGoal,
)
from app.agents.service import AgentService
from app.db.models import AgentStatus
from app.engine import EngineAgentState, SimulationEngine, SimulationState
from app.engine.service import PreparedAction
from app.gm import get_preset_arc
from app.schemas.agent_decision import AgentDecision, DecisionAction, DecisionActionType
from app.world import build_default_world_state, resolve_spawn_tile, tile_distance


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
    tile_x, tile_y = resolve_spawn_tile(location)
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
        tile_x=tile_x,
        tile_y=tile_y,
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


def test_action_outcome_only_marks_observe_and_move_rewrites_as_non_resolved() -> None:
    agent = _agent("a1", "Mara", "well")
    engine = SimulationEngine()
    turn = AgentTurnResult(
        decision=AgentDecision(
            inner_thought="A choice is made.",
            suspicion=None,
            action=DecisionAction(
                type=cast(DecisionActionType, "attack"),
                target="a2",
                location="well",
            ),
            dialogue=None,
            goal_progress="Incremental movement.",
            cooperation_intent="low",
        ),
        updated_memory=agent.memory,
        suspicion_level=agent.suspicion_level,
        prompt="stub",
    )

    blocked = PreparedAction(agent=agent, turn=turn, action_type="observe", location="well")
    rerouted = PreparedAction(agent=agent, turn=turn, action_type="move", location="street")
    resolved = PreparedAction(agent=agent, turn=turn, action_type="repair", location="workshop")

    assert engine._action_outcome(blocked) == "blocked"
    assert engine._action_outcome(rerouted) == "rerouted"
    assert engine._action_outcome(resolved) == "resolved"


@pytest.mark.asyncio
async def test_engine_runs_all_six_phases() -> None:
    service = _StubAgentService(
        {
            "a1": [("gather", "well"), ("talk", "well"), ("hoard", "well")],
            "a2": [("gather", "well"), ("observe", "well"), ("hoard", "well")],
            "a3": [("repair", "workshop"), ("observe", "workshop"), ("repair", "workshop")],
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
            "a1": [("repair", "workshop"), ("observe", "workshop"), ("repair", "workshop")],
            "a2": [("gather", "farm"), ("observe", "farm"), ("hoard", "farm")],
            "a3": [("repair", "workshop"), ("observe", "workshop"), ("repair", "workshop")],
        }
    )
    state = _state()
    state.agents[0].location = "workshop"
    state.agents[0].tile_x, state.agents[0].tile_y = resolve_spawn_tile("workshop")
    state.agents[1].location = "farm"
    state.agents[1].tile_x, state.agents[1].tile_y = resolve_spawn_tile("farm")
    state.agents[2].location = "workshop"
    state.agents[2].tile_x, state.agents[2].tile_y = resolve_spawn_tile("workshop")
    engine = SimulationEngine(agent_service=service, random_seed=4)

    result = await engine.run_round(state)

    assert 0 <= result.cooperation_ratio <= 1
    assert 0 <= result.threat_level <= 100
    assert result.world_state.resources.power >= 0


@pytest.mark.asyncio
async def test_engine_generates_social_events_and_relationship_updates() -> None:
    service = _StubAgentService(
        {
            "a1": [("talk", "town_hall"), ("talk", "town_hall"), ("observe", "town_hall")],
            "a2": [("talk", "town_hall"), ("talk", "town_hall"), ("observe", "town_hall")],
            "a3": [("observe", "town_hall"), ("observe", "town_hall"), ("observe", "town_hall")],
        }
    )
    state = _state()
    state.agents[0].location = "town_hall"
    state.agents[0].tile_x, state.agents[0].tile_y = resolve_spawn_tile("town_hall")
    state.agents[1].location = "town_hall"
    state.agents[1].tile_x, state.agents[1].tile_y = resolve_spawn_tile("town_hall")
    state.agents[2].location = "town_hall"
    state.agents[2].tile_x, state.agents[2].tile_y = resolve_spawn_tile("town_hall")
    engine = SimulationEngine(agent_service=service, random_seed=5)

    result = await engine.run_round(state)

    morning_kinds = {
        event.data.get("kind")
        for event in result.phases[2].events
        if isinstance(event.data.get("kind"), str)
    }
    midday_kinds = {
        event.data.get("kind")
        for event in result.phases[3].events
        if isinstance(event.data.get("kind"), str)
    }

    assert "agent_speak" in morning_kinds
    assert {"meeting_start", "meeting_speech", "meeting_vote", "meeting_result"} <= midday_kinds
    assert state.agents[0].relationships
    assert state.agents[1].relationships


@pytest.mark.asyncio
async def test_self_sacrifice_marks_agent_dead_and_stops_future_turns() -> None:
    service = _StubAgentService(
        {
            "a1": [("self_sacrifice", "town_hall"), ("repair", "workshop"), ("repair", "workshop")],
            "a2": [("gather", "well"), ("observe", "well"), ("repair", "workshop")],
            "a3": [("repair", "workshop"), ("observe", "workshop"), ("repair", "workshop")],
        }
    )
    state = _state()
    state.agents[0].location = "town_hall"
    state.agents[0].tile_x, state.agents[0].tile_y = resolve_spawn_tile("town_hall")
    engine = SimulationEngine(agent_service=service, random_seed=6)

    result = await engine.run_round(state)

    sacrifice_events = [
        event for event in result.phases[2].events if event.data.get("kind") == "self_sacrifice"
    ]
    afternoon_agent_ids = {
        event.data.get("agent_id")
        for event in result.phases[4].events
        if isinstance(event.data.get("agent_id"), str)
    }

    assert len(sacrifice_events) == 1
    assert service.calls["a1"] == 1
    assert state.agents[0].status == AgentStatus.DEAD
    assert state.agents[0].death_round == 1
    assert state.agents[0].death_cause == "self_sacrifice"
    assert state.sacrifice_history
    assert state.sacrifice_history[0].agent_id == "a1"
    assert state.agents[1].suspicion_level > 0
    assert "a1" not in afternoon_agent_ids
    assert "a1" not in state.world_state.location_occupancy.get("town_hall", [])


@pytest.mark.asyncio
async def test_multiple_self_sacrifices_are_explicitly_supported() -> None:
    service = _StubAgentService(
        {
            "a1": [("self_sacrifice", "town_hall"), ("repair", "workshop"), ("repair", "workshop")],
            "a2": [("self_sacrifice", "town_hall"), ("repair", "workshop"), ("repair", "workshop")],
            "a3": [("observe", "well"), ("observe", "well"), ("repair", "workshop")],
        }
    )
    state = _state()
    for agent in state.agents[:2]:
        agent.location = "town_hall"
        agent.tile_x, agent.tile_y = resolve_spawn_tile("town_hall")
    engine = SimulationEngine(agent_service=service, random_seed=9)

    result = await engine.run_round(state)

    morning_sacrifices = [
        event for event in result.phases[2].events if event.data.get("kind") == "self_sacrifice"
    ]
    afternoon_agent_ids = {
        event.data.get("agent_id")
        for event in result.phases[4].events
        if isinstance(event.data.get("agent_id"), str)
    }

    assert len(morning_sacrifices) == 2
    assert service.calls["a1"] == 1
    assert service.calls["a2"] == 1
    assert state.agents[0].status == AgentStatus.DEAD
    assert state.agents[1].status == AgentStatus.DEAD
    assert len(state.sacrifice_history) == 2
    assert "a1" not in afternoon_agent_ids
    assert "a2" not in afternoon_agent_ids
    assert "a1" not in state.world_state.location_occupancy.get("town_hall", [])
    assert "a2" not in state.world_state.location_occupancy.get("town_hall", [])


@pytest.mark.asyncio
async def test_engine_caps_movement_and_converts_far_actions_into_travel() -> None:
    service = _StubAgentService(
        {
            "a1": [("repair", "workshop"), ("observe", None), ("observe", None)],
            "a2": [("observe", "well"), ("observe", "well"), ("observe", "well")],
            "a3": [("observe", "workshop"), ("observe", "workshop"), ("observe", "workshop")],
        }
    )
    state = _state()
    start_tile = resolve_spawn_tile("well")
    state.agents[0].location = "well"
    state.agents[0].tile_x, state.agents[0].tile_y = start_tile

    engine = SimulationEngine(agent_service=service, random_seed=7)
    result = await engine.run_round(state)

    first_action = next(
        event for event in result.phases[2].events if event.data.get("agent_id") == "a1"
    )
    end_tile = (state.agents[0].tile_x, state.agents[0].tile_y)

    assert first_action.data["action_type"] == "move"
    assert "traveling" in first_action.summary
    assert tile_distance(start_tile, end_tile) <= engine.MAX_MOVE_TILES_PER_ACTION
    assert state.agents[0].location != "workshop"


@pytest.mark.asyncio
async def test_engine_blocks_agent_interactions_without_proximity() -> None:
    service = _StubAgentService(
        {
            "a1": [("attack", "well"), ("observe", "well"), ("observe", "well")],
            "a2": [("observe", "town_hall"), ("observe", "town_hall"), ("observe", "town_hall")],
            "a3": [("observe", "workshop"), ("observe", "workshop"), ("observe", "workshop")],
        }
    )
    state = _state()
    state.agents[0].location = "well"
    state.agents[0].tile_x, state.agents[0].tile_y = resolve_spawn_tile("well")
    state.agents[1].location = "town_hall"
    state.agents[1].tile_x, state.agents[1].tile_y = resolve_spawn_tile("town_hall")
    state.agents[2].location = "workshop"
    state.agents[2].tile_x, state.agents[2].tile_y = resolve_spawn_tile("workshop")

    engine = SimulationEngine(agent_service=service, random_seed=8)
    result = await engine.run_round(state)

    first_action = next(
        event for event in result.phases[2].events if event.data.get("agent_id") == "a1"
    )

    assert first_action.data["action_type"] == "observe"
    assert "close enough" in first_action.summary
    assert state.agents[0].suspicion_level >= 5


@pytest.mark.asyncio
async def test_engine_blocks_resource_actions_at_invalid_locations() -> None:
    service = _StubAgentService(
        {
            "a1": [("repair", "bar"), ("observe", "bar"), ("observe", "bar")],
            "a2": [("observe", "bar"), ("observe", "bar"), ("observe", "bar")],
            "a3": [("observe", "workshop"), ("observe", "workshop"), ("observe", "workshop")],
        }
    )
    state = _state()
    state.agents[0].location = "bar"
    state.agents[0].tile_x, state.agents[0].tile_y = resolve_spawn_tile("bar")
    state.agents[1].location = "bar"
    state.agents[1].tile_x, state.agents[1].tile_y = resolve_spawn_tile("bar")

    materials_before = state.world_state.resources.materials
    engine = SimulationEngine(agent_service=service, random_seed=9)
    result = await engine.run_round(state)

    first_action = next(
        event for event in result.phases[2].events if event.data.get("agent_id") == "a1"
    )

    assert first_action.data["action_type"] == "observe"
    assert "requires one of" in first_action.summary
    assert state.world_state.resources.materials <= materials_before


@pytest.mark.asyncio
async def test_engine_does_not_move_agent_when_reached_action_is_blocked() -> None:
    service = _StubAgentService(
        {
            "a1": [("repair", "brothel"), ("observe", "well"), ("observe", "well")],
            "a2": [("observe", "workshop"), ("observe", "workshop"), ("observe", "workshop")],
            "a3": [("observe", "well"), ("observe", "well"), ("observe", "well")],
        }
    )
    state = _state()
    start_tile = resolve_spawn_tile("well")
    state.agents[0].location = "well"
    state.agents[0].tile_x, state.agents[0].tile_y = start_tile
    state.agents[1].location = "workshop"
    state.agents[1].tile_x, state.agents[1].tile_y = resolve_spawn_tile("workshop")

    engine = SimulationEngine(agent_service=service, random_seed=11)
    result = await engine.run_round(state)

    first_action = next(
        event for event in result.phases[2].events if event.data.get("agent_id") == "a1"
    )

    assert first_action.data["action_type"] == "observe"
    assert "requires one of" in first_action.summary
    assert (state.agents[0].tile_x, state.agents[0].tile_y) == start_tile
    assert state.agents[0].location == "well"


@pytest.mark.asyncio
async def test_engine_allows_vote_action_in_meeting_hall() -> None:
    service = _StubAgentService(
        {
            "a1": [("vote", "town_hall"), ("observe", "town_hall"), ("observe", "town_hall")],
            "a2": [("observe", "workshop"), ("observe", "workshop"), ("observe", "workshop")],
            "a3": [("observe", "well"), ("observe", "well"), ("observe", "well")],
        }
    )
    state = _state()
    state.agents[0].location = "town_hall"
    state.agents[0].tile_x, state.agents[0].tile_y = resolve_spawn_tile("town_hall")
    state.agents[1].location = "workshop"
    state.agents[1].tile_x, state.agents[1].tile_y = resolve_spawn_tile("workshop")
    state.agents[2].location = "well"
    state.agents[2].tile_x, state.agents[2].tile_y = resolve_spawn_tile("well")

    engine = SimulationEngine(agent_service=service, random_seed=10)
    result = await engine.run_round(state)

    first_action = next(
        event for event in result.phases[2].events if event.data.get("agent_id") == "a1"
    )

    assert first_action.data["action_type"] == "vote"


@pytest.mark.asyncio
async def test_engine_forms_cults_and_applies_exile_results() -> None:
    service = _StubAgentService(
        {
            "a1": [("talk", "town_hall"), ("pray", "town_hall"), ("observe", "town_hall")],
            "a2": [("talk", "town_hall"), ("observe", "town_hall"), ("repair", "workshop")],
            "a3": [("observe", "town_hall"), ("observe", "town_hall"), ("repair", "workshop")],
        }
    )
    state = _state()
    state.agents[0].goal.archetype = "belief_transformation"
    state.agents[0].personality.trait_tags = ["devout", "guarded"]
    state.agents[0].suspicion_level = 85
    state.world_state.threat_level = 72
    state.agents[0].relationships["a2"] = RelationshipMemory(trust=4, history=[], notes=None)
    state.agents[1].relationships["a1"] = RelationshipMemory(trust=3, history=[], notes=None)
    state.agents[0].location = "town_hall"
    state.agents[0].tile_x, state.agents[0].tile_y = resolve_spawn_tile("town_hall")
    state.agents[1].location = "town_hall"
    state.agents[1].tile_x, state.agents[1].tile_y = resolve_spawn_tile("town_hall")
    state.agents[2].location = "town_hall"
    state.agents[2].tile_x, state.agents[2].tile_y = resolve_spawn_tile("town_hall")
    engine = SimulationEngine(agent_service=service, random_seed=8)

    result = await engine.run_round(state)

    midday_kinds = {
        event.data.get("kind")
        for event in result.phases[3].events
        if isinstance(event.data.get("kind"), str)
    }
    assert "cult_activity" in midday_kinds
    assert "exile_vote" in midday_kinds
    assert state.exile_history
    assert state.agents[0].status == AgentStatus.EXILED
