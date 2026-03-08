from __future__ import annotations

from typing import Any

import pytest

from app.agents.brain import AgentBrain, build_agent_prompt
from app.agents.models import (
    AgentContext,
    AgentMemoryState,
    KeyMemory,
    MemoryEvent,
    Observation,
    PersonalityAxes,
    PersonalityProfile,
    RelationshipMemory,
    SecretGoal,
)
from app.engine.models import (
    ConversationOutcome,
    ConversationTurn,
    EngineAgentState,
    SimulationState,
)
from app.agents.registry import get_action_definition
from app.agents.service import AgentService
from app.agents.suspicion import apply_suspicion_trigger
from app.engine.service import SimulationEngine
from app.gm import get_preset_arc
from app.gm.models import CrisisEvent, GMPlanData, GMPlanRecord, ResourceDelta
from app.llm.models import (
    LLMResult,
    MemoryConsolidationDecision,
    MemoryPromotionDecision,
    RelationshipConsolidationDecision,
)
from app.llm.service import LLMService
from app.schemas.agent_decision import AGENT_DECISION_MAX_TOKENS
from app.world import build_default_world_state


class _StubLLMService(LLMService):
    def __init__(self) -> None:
        self.last_max_tokens: int | None = None

    async def generate_agent_decision(
        self,
        *,
        messages: list[dict[str, str]],
        response_format: dict[str, object] | type[Any],
        metadata: dict[str, object] | None = None,
        model_override: str | None = None,
        generation_name: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMResult:
        self.last_max_tokens = max_tokens
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


class _StubMemoryLLMService:
    def __init__(
        self,
        decision: MemoryPromotionDecision | None = None,
        consolidation: MemoryConsolidationDecision | None = None,
        relationship_consolidation: RelationshipConsolidationDecision | None = None,
    ) -> None:
        self.classify_calls = 0
        self.relationship_consolidation_calls = 0
        self._decision = decision or MemoryPromotionDecision(
            promote_to_key_memory=True,
            meaning="This felt like a pattern that could not be ignored.",
            salience_type="threat",
            confidence=84,
        )
        self._consolidation = consolidation or MemoryConsolidationDecision(
            create_summary=True,
            summary="The town keeps emitting signals that feel staged.",
            meaning="Repeated anomalies have hardened into the belief that the environment is artificial.",
            salience_type="identity",
            confidence=81,
        )
        self._relationship_consolidation = (
            relationship_consolidation
            or RelationshipConsolidationDecision(
                update_notes=True,
                notes="Jon usually tries to steady me when the town starts to spiral.",
            )
        )

    async def classify_memory_event(
        self,
        *,
        event: MemoryEvent,
        goal: SecretGoal | None,
        suspicion_level: float,
        recent_key_memories: list[KeyMemory],
        experiment_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
    ) -> MemoryPromotionDecision:
        self.classify_calls += 1
        return self._decision

    async def consolidate_memory_events(
        self,
        *,
        events: list[MemoryEvent],
        goal: SecretGoal | None,
        suspicion_level: float,
        recent_key_memories: list[KeyMemory],
        experiment_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
    ) -> MemoryConsolidationDecision:
        return self._consolidation

    async def consolidate_relationship_memory(
        self,
        *,
        other_agent_id: str,
        relationship: RelationshipMemory,
        goal: SecretGoal | None,
        suspicion_level: float,
        experiment_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
        round_number: int | None = None,
    ) -> RelationshipConsolidationDecision:
        self.relationship_consolidation_calls += 1
        return self._relationship_consolidation


class _FailingMemoryConsolidationLLMService(_StubMemoryLLMService):
    async def consolidate_memory_events(
        self,
        *,
        events: list[MemoryEvent],
        goal: SecretGoal | None,
        suspicion_level: float,
        recent_key_memories: list[KeyMemory],
        experiment_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
    ) -> MemoryConsolidationDecision:
        raise RuntimeError("memory consolidation unavailable")


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
        relationships={
            "agent-2": RelationshipMemory(
                trust=7.5,
                history=[
                    "Jon backed me in the meeting.",
                    "Jon warned me before the room turned ugly.",
                ],
                notes="Jon usually tries to steady me when the town starts to spiral.",
            )
        },
        suspicion_level=12,
        world_state=build_default_world_state(round_number=4),
        current_crisis={"type": "social", "description": "Rumors are spreading."},
        observations=[
            Observation(summary="Someone left the bar through the back door.", importance=4)
        ],
    )


def _engine_state() -> SimulationState:
    return SimulationState(
        experiment_id="exp-1",
        experiment_name="Memory Trial",
        total_rounds=8,
        current_round=1,
        status="running",
        auto_approve=True,
        arc=get_preset_arc("slow_burn"),
        world_state=build_default_world_state(round_number=2),
        agents=[
            EngineAgentState(
                agent_id="a1",
                name="Mara",
                personality=_context().personality,
                goal=_context().goal,
                memory=AgentMemoryState(),
                location="bar",
                relationships={},
            ),
            EngineAgentState(
                agent_id="a2",
                name="Jon",
                personality=PersonalityProfile(
                    axes=PersonalityAxes(
                        paranoia=35,
                        empathy=68,
                        dominance=44,
                        impulsiveness=39,
                        loyalty=75,
                        ambition=48,
                    ),
                    trait_tags=["dutiful", "protective"],
                    self_concept="Someone has to hold things together.",
                ),
                goal=SecretGoal(
                    archetype="communal_survival",
                    text="Keep the town functional until rescue arrives.",
                ),
                memory=AgentMemoryState(),
                location="bar",
                relationships={},
            ),
        ],
        gm_plan=GMPlanRecord(
            status="applied",
            plan=GMPlanData(
                round=2,
                round_theme="Rumors spread",
                reasoning="Push social mistrust",
                crisis_event=CrisisEvent(
                    type="social",
                    severity="medium",
                    description="Rumors spread that someone is staging the shortages.",
                ),
                resource_modifiers=ResourceDelta(),
                environmental=None,
                narration="Everyone feels watched.",
                meta_hint=None,
            ),
        ),
    )


def test_prompt_includes_hybrid_personality_and_goal() -> None:
    prompt = build_agent_prompt(_context())
    assert "paranoia" in prompt
    assert "guarded" in prompt
    assert "truth_revelation" in prompt
    assert "undertaker_01" in prompt
    assert "attack" in prompt
    assert "trust=7.5" in prompt
    assert "steady me" in prompt


def test_prompt_renders_plain_none_for_empty_relationships() -> None:
    prompt = build_agent_prompt(_context().model_copy(update={"relationships": {}}))

    assert "Relationships: None" in prompt
    assert "Relationships: ['None']" not in prompt


def test_prompt_instructs_concise_inner_thoughts() -> None:
    prompt = build_agent_prompt(_context())

    assert "Keep `inner_thought` to 1-2 short sentences" in prompt
    assert "Good `inner_thought`" in prompt


@pytest.mark.asyncio
async def test_decide_uses_agent_decision_token_cap() -> None:
    service = _StubLLMService()
    brain = AgentBrain(llm_service=service)

    await brain.decide(_context())

    assert service.last_max_tokens == AGENT_DECISION_MAX_TOKENS


@pytest.mark.asyncio
async def test_memory_registers_recent_and_key_observations() -> None:
    service = AgentService(memory_llm_service=_StubMemoryLLMService())
    memory = service.initialize_memory()
    memory = await service.register_observation(
        memory,
        round_number=2,
        summary="Jon lied about where he found the batteries.",
        emotional_charge=18,
        important=True,
    )

    assert memory.recent_events[-1].summary.startswith("Jon lied")
    assert memory.key_memories[-1].summary.startswith("Jon lied")
    assert memory.key_memories[-1].meaning.startswith("This felt like a pattern")
    assert memory.key_memories[-1].salience_type == "threat"


@pytest.mark.asyncio
async def test_memory_uses_llm_classifier_for_key_memory_promotion() -> None:
    service = AgentService(memory_llm_service=_StubMemoryLLMService())
    memory = service.initialize_memory()

    memory = await service.register_observation(
        memory,
        round_number=3,
        summary="The flood siren screamed through the square.",
        emotional_charge=4,
        goal=_context().goal,
        suspicion_level=18,
    )

    assert memory.key_memories[-1].summary.startswith("The flood siren")
    assert memory.key_memories[-1].meaning.startswith("This felt like a pattern")
    assert memory.key_memories[-1].salience_type == "threat"


@pytest.mark.asyncio
async def test_memory_skips_auto_promotion_when_classifier_declines() -> None:
    service = AgentService(
        memory_llm_service=_StubMemoryLLMService(
            MemoryPromotionDecision(
                promote_to_key_memory=False,
                meaning=None,
                salience_type="other",
                confidence=22,
            )
        )
    )
    memory = service.initialize_memory()

    memory = await service.register_observation(
        memory,
        round_number=3,
        summary="A quiet wind moved through the market.",
        emotional_charge=4,
    )

    assert memory.key_memories == []


@pytest.mark.asyncio
async def test_memory_consolidates_new_events_into_key_memory() -> None:
    service = AgentService(memory_llm_service=_StubMemoryLLMService())
    memory = AgentMemoryState(
        recent_events=[
            MemoryEvent(
                round_number=1, summary="The fence hummed after curfew.", emotional_charge=5
            ),
            MemoryEvent(
                round_number=2, summary="The lights flickered in sequence.", emotional_charge=4
            ),
            MemoryEvent(
                round_number=3, summary="A voice echoed from the empty square.", emotional_charge=7
            ),
        ]
    )

    memory = await service.consolidate_memory(
        memory,
        goal=_context().goal,
        suspicion_level=36,
    )

    assert memory.last_consolidated_round == 3
    assert memory.key_memories[-1].summary.startswith("The town keeps emitting signals")
    assert memory.key_memories[-1].salience_type == "identity"


@pytest.mark.asyncio
async def test_memory_consolidation_advances_cursor_when_declined() -> None:
    service = AgentService(
        memory_llm_service=_StubMemoryLLMService(
            consolidation=MemoryConsolidationDecision(
                create_summary=False,
                summary=None,
                meaning=None,
                salience_type="other",
                confidence=20,
            )
        )
    )
    memory = AgentMemoryState(
        recent_events=[
            MemoryEvent(round_number=2, summary="A rumor spread at breakfast.", emotional_charge=3),
            MemoryEvent(
                round_number=3, summary="Jon denied hearing the signal.", emotional_charge=4
            ),
            MemoryEvent(
                round_number=4, summary="Nobody slept well after the storm.", emotional_charge=6
            ),
        ]
    )

    memory = await service.consolidate_memory(
        memory,
        goal=_context().goal,
        suspicion_level=22,
    )

    assert memory.last_consolidated_round == 4
    assert memory.key_memories == []


@pytest.mark.asyncio
async def test_memory_consolidation_preserves_cursor_when_llm_fails() -> None:
    service = AgentService(memory_llm_service=_FailingMemoryConsolidationLLMService())
    memory = AgentMemoryState(
        recent_events=[
            MemoryEvent(round_number=2, summary="A rumor spread at breakfast.", emotional_charge=3),
            MemoryEvent(
                round_number=3, summary="Jon denied hearing the signal.", emotional_charge=4
            ),
            MemoryEvent(
                round_number=4, summary="Nobody slept well after the storm.", emotional_charge=6
            ),
        ]
    )

    memory = await service.consolidate_memory(
        memory,
        goal=_context().goal,
        suspicion_level=22,
    )

    assert memory.last_consolidated_round == 0
    assert memory.key_memories == []


@pytest.mark.asyncio
async def test_relationship_memory_consolidates_notes() -> None:
    llm_service = _StubMemoryLLMService()
    service = AgentService(memory_llm_service=llm_service)
    memory = AgentMemoryState(
        relationship_memory={
            "agent-2": RelationshipMemory(
                trust=6.5,
                history=[
                    "Jon backed me in the meeting.",
                    "Jon warned me before the vote turned ugly.",
                    "Jon kept everyone calm when the room started spiraling.",
                ],
            )
        }
    )

    memory = await service.consolidate_relationship_memory(
        memory,
        goal=_context().goal,
        suspicion_level=24,
    )

    assert memory.relationship_memory["agent-2"].notes is not None
    assert memory.relationship_consolidation_signatures["agent-2"]
    assert "steady me" in memory.relationship_memory["agent-2"].notes

    memory = await service.consolidate_relationship_memory(
        memory,
        goal=_context().goal,
        suspicion_level=24,
    )

    assert llm_service.relationship_consolidation_calls == 1


@pytest.mark.asyncio
async def test_relationship_memory_skips_consolidation_for_short_history() -> None:
    service = AgentService(memory_llm_service=_StubMemoryLLMService())
    memory = AgentMemoryState(
        relationship_memory={
            "agent-2": RelationshipMemory(
                trust=2.0,
                history=[
                    "Jon gave me a cautious look.",
                    "Jon voted the same way I did.",
                ],
            )
        }
    )

    memory = await service.consolidate_relationship_memory(
        memory,
        goal=_context().goal,
        suspicion_level=10,
    )

    assert memory.relationship_memory["agent-2"].notes is None


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


@pytest.mark.asyncio
async def test_conversation_updates_relationship_memory_for_both_participants() -> None:
    llm_service = _StubMemoryLLMService()
    engine = SimulationEngine(agent_service=AgentService(memory_llm_service=llm_service))
    state = _engine_state()

    outcomes = [
        ConversationOutcome(
            location="bar",
            participants=["a1", "a2"],
            turns=[
                ConversationTurn(
                    speaker_id="a1",
                    speaker_name="Mara",
                    listener_id="a2",
                    listener_name="Jon",
                    tone="suspicious",
                    content="Mara warns Jon that the shortage feels staged.",
                    trust_delta=-1.5,
                ),
                ConversationTurn(
                    speaker_id="a2",
                    speaker_name="Jon",
                    listener_id="a1",
                    listener_name="Mara",
                    tone="supportive",
                    content="Jon tells Mara they need to stay steady.",
                    trust_delta=2.0,
                ),
            ],
            summary="They trade a tense read of the situation.",
        )
    ]

    await engine._apply_conversation_outcomes(state, outcomes)

    mara = next(agent for agent in state.agents if agent.agent_id == "a1")
    jon = next(agent for agent in state.agents if agent.agent_id == "a2")

    assert mara.relationships["a2"].trust == 0.5
    assert jon.relationships["a1"].trust == 0.5
    assert len(mara.relationships["a2"].history) == 2
    assert len(jon.relationships["a1"].history) == 2
    assert llm_service.classify_calls == 0


@pytest.mark.asyncio
async def test_night_reflections_skip_classifier_for_low_suspicion_agents() -> None:
    llm_service = _StubMemoryLLMService()
    engine = SimulationEngine(agent_service=AgentService(memory_llm_service=llm_service))
    state = _engine_state()

    await engine._night_phase(state, cooperation_ratio=0.6)

    assert llm_service.classify_calls == 0


@pytest.mark.asyncio
async def test_night_phase_materializes_active_agents_once(monkeypatch: pytest.MonkeyPatch) -> None:
    llm_service = _StubMemoryLLMService()
    engine = SimulationEngine(agent_service=AgentService(memory_llm_service=llm_service))
    state = _engine_state()
    active_agent_calls = 0
    original_active_agents = engine._active_agents

    def counting_active_agents(current_state: SimulationState) -> list[EngineAgentState]:
        nonlocal active_agent_calls
        active_agent_calls += 1
        return original_active_agents(current_state)

    monkeypatch.setattr(engine, "_active_agents", counting_active_agents)

    await engine._night_phase(state, cooperation_ratio=0.6)

    assert active_agent_calls == 1


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
