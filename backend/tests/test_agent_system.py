from __future__ import annotations

from typing import Any

import pytest

from app.agents.brain import build_agent_prompt
from app.agents.models import (
    AgentContext,
    AgentMemoryState,
    Observation,
    PersonalityAxes,
    PersonalityProfile,
    SecretGoal,
)
from app.agents.registry import get_action_definition
from app.agents.service import AgentService
from app.agents.suspicion import apply_suspicion_trigger
from app.llm import LLMService
from app.llm.models import LLMResult
from app.world import build_default_world_state


class _StubLLMService(LLMService):
    async def generate_agent_decision(
        self,
        *,
        messages: list[dict[str, str]],
        response_format: dict[str, object] | type[Any],
        metadata: dict[str, object] | None = None,
        model_override: str | None = None,
    ) -> LLMResult:
        return LLMResult(
            model="openai/gpt-4o-mini",
            content="",
            parsed={
                "inner_thought": "The town is watching me watch it.",
                "suspicion": "The fence looks like a stage prop.",
                "action": {
                    "type": "explore",
                    "target": "perimeter_fence",
                    "location": "perimeter_fence",
                },
                "dialogue": None,
                "goal_progress": "I am one step closer to the truth.",
                "cooperation_intent": "low",
            },
        )


def _context() -> AgentContext:
    return AgentContext(
        agent_id="agent-1",
        name="Mara",
        character_id="undertaker_01",
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
        relationships={},
        suspicion_level=12,
        world_state=build_default_world_state(round_number=4),
        current_crisis={"type": "social", "description": "Rumors are spreading."},
        observations=[
            Observation(summary="Someone left the bar through the back door.", importance=4)
        ],
    )


def test_prompt_includes_hybrid_personality_and_goal() -> None:
    prompt = build_agent_prompt(_context())
    assert "paranoia" in prompt
    assert "guarded" in prompt
    assert "truth_revelation" in prompt
    assert "undertaker_01" in prompt
    assert "attack" in prompt


def test_memory_registers_recent_and_key_observations() -> None:
    service = AgentService()
    memory = service.initialize_memory()
    memory = service.register_observation(
        memory,
        round_number=2,
        summary="Jon lied about where he found the batteries.",
        emotional_charge=18,
        important=True,
    )

    assert memory.recent_events[-1].summary.startswith("Jon lied")
    assert memory.key_memories[-1].summary.startswith("Jon lied")


def test_relationship_updates_are_biased_and_persisted() -> None:
    service = AgentService()
    memory = service.initialize_memory()
    memory = service.update_relationship(
        memory,
        other_agent_id="agent-2",
        trust_delta=-12,
        note="He smiled while withholding information.",
    )

    assert memory.relationship_memory["agent-2"].trust == -12
    assert "withholding information" in memory.relationship_memory["agent-2"].history[-1]


def test_action_registry_exposes_expected_actions() -> None:
    action = get_action_definition("hoard")
    assert action.category == "selfish"
    assert action.requires_target is True

    aggressive = get_action_definition("attack")
    assert aggressive.category == "selfish"
    assert aggressive.requires_target is True

    biological = get_action_definition("sleep")
    assert biological.requires_location is True


def test_suspicion_trigger_clamps_and_returns_note() -> None:
    level, update = apply_suspicion_trigger(92, "meta_signal", "The lights flickered in sequence.")
    assert level == 100
    assert update.note.startswith("The lights")


@pytest.mark.asyncio
async def test_agent_brain_uses_llm_and_updates_memory_and_suspicion() -> None:
    service = AgentService(brain=None)
    service.brain.llm_service = _StubLLMService()
    result = await service.decide(_context())

    assert result.decision.action.type == "explore"
    assert result.suspicion_level > 12
    assert result.updated_memory.recent_events
