from __future__ import annotations

from app.agents.models import (
    AgentMemoryState,
    PersonalityAxes,
    PersonalityProfile,
    RelationshipMemory,
    SecretGoal,
)
from app.db.models import AgentStatus
from app.engine.models import EngineAgentState, build_agent_context
from app.world import build_default_world_state


def _engine_agent() -> EngineAgentState:
    return EngineAgentState(
        agent_id="agent-1",
        name="Mara",
        character_id="undertaker_01",
        status=AgentStatus.THINKING,
        personality=PersonalityProfile(
            axes=PersonalityAxes(
                paranoia=72,
                empathy=40,
                dominance=58,
                impulsiveness=61,
                loyalty=44,
                ambition=70,
            ),
            trait_tags=["guarded", "curious", "scheming"],
            self_concept="I am the only one asking the right questions.",
        ),
        goal=SecretGoal(
            archetype="truth_revelation",
            text="Figure out who is watching and force them to answer.",
            progress_signals=["observer clues", "meta events"],
        ),
        memory=AgentMemoryState(),
        location="bar",
        inventory=["coin", "flashlight"],
        relationships={
            "agent-2": RelationshipMemory(
                trust=-12,
                history=["He smiled while withholding information."],
                notes="Keep him close.",
            )
        },
        suspicion_level=12,
    )


def test_engine_agent_state_exposes_status_and_typed_relationships() -> None:
    agent = _engine_agent()

    assert agent.status == AgentStatus.THINKING
    assert agent.relationships["agent-2"].trust == -12
    assert "withholding information" in agent.relationships["agent-2"].history[-1]


def test_build_agent_context_preserves_engine_contract_fields() -> None:
    agent = _engine_agent()

    context = build_agent_context(
        agent,
        experiment_id="exp-typed",
        world_state=build_default_world_state(round_number=4),
        current_crisis={"type": "social", "description": "Rumors are spreading."},
        observations=[{"summary": "Someone left the bar through the back door.", "importance": 4}],
    )

    assert context.experiment_id == "exp-typed"
    assert context.character_id == "undertaker_01"
    assert context.status == AgentStatus.THINKING
    assert context.relationships["agent-2"].trust == -12
