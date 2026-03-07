from __future__ import annotations

from app.agents.brain import AgentBrain
from app.agents.memory import add_key_memory, append_recent_event, update_relationship_memory
from app.agents.models import (
    AgentContext,
    AgentMemoryState,
    MemoryConsolidationDecision,
    MemoryPromotionDecision,
    AgentTurnResult,
    KeyMemory,
    MemoryEvent,
    PersonalityProfile,
    SecretGoal,
)
from app.llm import LLMService

MEMORY_CONSOLIDATION_MIN_EVENTS = 3
RELATIONSHIP_CONSOLIDATION_MIN_HISTORY = 3


class AgentService:
    def __init__(
        self,
        brain: AgentBrain | None = None,
        memory_llm_service: LLMService | None = None,
    ) -> None:
        self.brain: AgentBrain = brain or AgentBrain()
        self.memory_llm_service = memory_llm_service or self.brain.llm_service

    def initialize_memory(self) -> AgentMemoryState:
        return AgentMemoryState()

    async def register_observation(
        self,
        memory: AgentMemoryState,
        *,
        round_number: int,
        summary: str,
        emotional_charge: int = 0,
        important: bool = False,
        tags: list[str] | None = None,
        goal: SecretGoal | None = None,
        suspicion_level: float = 0,
    ) -> AgentMemoryState:
        event = MemoryEvent(
            round_number=round_number,
            summary=summary,
            emotional_charge=emotional_charge,
            tags=tags or [],
        )
        updated = append_recent_event(
            memory,
            event,
        )
        if important:
            updated = add_key_memory(updated, self._build_key_memory(event, None))
            return updated

        try:
            decision = await self.memory_llm_service.classify_memory_event(
                event=event,
                goal=goal,
                suspicion_level=suspicion_level,
                recent_key_memories=memory.key_memories,
            )
        except Exception:
            decision = None

        if decision is not None and decision.promote_to_key_memory:
            updated = add_key_memory(updated, self._build_key_memory(event, decision))
        return updated

    def update_relationship(
        self,
        memory: AgentMemoryState,
        *,
        other_agent_id: str,
        trust_delta: float,
        note: str,
    ) -> AgentMemoryState:
        return update_relationship_memory(
            memory, other_agent_id=other_agent_id, trust_delta=trust_delta, note=note
        )

    async def decide(self, context: AgentContext) -> AgentTurnResult:
        return await self.brain.decide(context)

    async def consolidate_memory(
        self,
        memory: AgentMemoryState,
        *,
        goal: SecretGoal | None,
        suspicion_level: float,
    ) -> AgentMemoryState:
        unconsolidated_events = [
            event
            for event in memory.recent_events
            if event.round_number > memory.last_consolidated_round
        ]
        if len(unconsolidated_events) < MEMORY_CONSOLIDATION_MIN_EVENTS:
            return memory

        try:
            decision = await self.memory_llm_service.consolidate_memory_events(
                events=unconsolidated_events,
                goal=goal,
                suspicion_level=suspicion_level,
                recent_key_memories=memory.key_memories,
            )
        except Exception:
            return memory

        updated = memory.model_copy(
            update={"last_consolidated_round": unconsolidated_events[-1].round_number}
        )
        if decision is None or not decision.create_summary:
            return updated

        key_memory = self._build_consolidated_key_memory(unconsolidated_events, decision)
        return add_key_memory(updated, key_memory)

    async def consolidate_relationship_memory(
        self,
        memory: AgentMemoryState,
        *,
        goal: SecretGoal | None,
        suspicion_level: float,
    ) -> AgentMemoryState:
        relationships = dict(memory.relationship_memory)
        changed = False

        for other_agent_id, relationship in relationships.items():
            if len(relationship.history) < RELATIONSHIP_CONSOLIDATION_MIN_HISTORY:
                continue
            try:
                decision = await self.memory_llm_service.consolidate_relationship_memory(
                    other_agent_id=other_agent_id,
                    relationship=relationship,
                    goal=goal,
                    suspicion_level=suspicion_level,
                )
            except Exception:
                decision = None

            if decision is None or not decision.update_notes or not decision.notes:
                continue

            relationships[other_agent_id] = relationship.model_copy(
                update={"notes": decision.notes}
            )
            changed = True

        if not changed:
            return memory
        return memory.model_copy(update={"relationship_memory": relationships})

    def _build_key_memory(
        self,
        event: MemoryEvent,
        decision: MemoryPromotionDecision | None,
    ) -> KeyMemory:
        if decision is not None:
            meaning = decision.meaning or event.summary
            confidence = decision.confidence
            salience_type = decision.salience_type
        else:
            meaning = event.summary
            confidence = 75
            salience_type = "other"

        return KeyMemory(
            summary=event.summary,
            meaning=meaning,
            round_number=event.round_number,
            confidence=confidence,
            salience_type=salience_type,
        )

    def _build_consolidated_key_memory(
        self,
        events: list[MemoryEvent],
        decision: MemoryConsolidationDecision,
    ) -> KeyMemory:
        latest_round = max(event.round_number for event in events)
        summary = decision.summary or events[-1].summary
        meaning = decision.meaning or summary
        return KeyMemory(
            summary=summary,
            meaning=meaning,
            round_number=latest_round,
            confidence=decision.confidence,
            salience_type=decision.salience_type,
        )


def build_personality_payload(profile: PersonalityProfile) -> dict[str, object]:
    return profile.model_dump(mode="json")


def build_goal_payload(goal: SecretGoal) -> dict[str, object]:
    return goal.model_dump(mode="json")
