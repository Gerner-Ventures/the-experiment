from __future__ import annotations

from app.agents.brain import AgentBrain
from app.agents.memory import add_key_memory, append_recent_event, update_relationship_memory
from app.agents.models import (
    AgentContext,
    AgentMemoryState,
    AgentTurnResult,
    KeyMemory,
    MemoryEvent,
    PersonalityProfile,
    SecretGoal,
)


class AgentService:
    def __init__(self, brain: AgentBrain | None = None) -> None:
        self.brain = brain or AgentBrain()

    def initialize_memory(self) -> AgentMemoryState:
        return AgentMemoryState()

    def register_observation(
        self,
        memory: AgentMemoryState,
        *,
        round_number: int,
        summary: str,
        emotional_charge: int = 0,
        important: bool = False,
    ) -> AgentMemoryState:
        updated = append_recent_event(
            memory,
            MemoryEvent(round_number=round_number, summary=summary, emotional_charge=emotional_charge),
        )
        if important:
            updated = add_key_memory(
                updated,
                KeyMemory(
                    summary=summary,
                    meaning=summary,
                    round_number=round_number,
                    confidence=75,
                ),
            )
        return updated

    def update_relationship(
        self,
        memory: AgentMemoryState,
        *,
        other_agent_id: str,
        trust_delta: float,
        note: str,
    ) -> AgentMemoryState:
        return update_relationship_memory(memory, other_agent_id=other_agent_id, trust_delta=trust_delta, note=note)

    async def decide(self, context: AgentContext) -> AgentTurnResult:
        return await self.brain.decide(context)


def build_personality_payload(profile: PersonalityProfile) -> dict[str, object]:
    return profile.model_dump(mode="json")


def build_goal_payload(goal: SecretGoal) -> dict[str, object]:
    return goal.model_dump(mode="json")
