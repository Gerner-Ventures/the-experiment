from __future__ import annotations

import logging

from app.actions import DecisionActionName
from app.agents.models import (
    AgentContext,
    AgentMemoryState,
    AgentTurnResult,
    KeyMemory,
    MemoryEvent,
)
from app.agents.registry import get_action_definition
from app.agents.suspicion import apply_suspicion_trigger
from app.llm import LLMService
from app.schemas.agent_decision import (
    AGENT_DECISION_MAX_TOKENS,
    AGENT_INNER_THOUGHT_MAX_LENGTH,
    AgentDecision,
    DECISION_ACTION_TYPES,
    DecisionAction,
)

logger = logging.getLogger(__name__)


def build_agent_prompt(context: AgentContext) -> str:
    relationship_lines = []
    for agent_id, relationship in context.relationships.items():
        line = f"{agent_id}: trust={relationship.trust}"
        if relationship.notes:
            line += f", impression={relationship.notes}"
        if relationship.history:
            line += f", recent_history={relationship.history[-2:]}"
        relationship_lines.append(line)

    return (
        f"You are {context.name}.\n"
        f"Character ID: {context.character_id or 'unassigned'}\n"
        f"Location: {context.location or 'unknown'}\n"
        f"Status: {context.status.value}\n"
        f"Personality axes: {context.personality.axes.model_dump()}\n"
        f"Trait tags: {context.personality.trait_tags}\n"
        f"Self concept: {context.personality.self_concept or 'None'}\n"
        f"Secret goal: {context.goal.text} ({context.goal.archetype})\n"
        f"Inventory: {context.inventory}\n"
        f"Suspicion level: {context.suspicion_level}\n"
        f"World resources: {context.world_state.resources.model_dump()}\n"
        f"Current crisis: {context.current_crisis or 'None'}\n"
        f"Observations: {[observation.summary for observation in context.observations]}\n"
        f"Recent events: {[event.summary for event in context.memory.recent_events]}\n"
        f"Key memories: {[memory.meaning for memory in context.memory.key_memories]}\n"
        f"Relationships: {relationship_lines if relationship_lines else 'None'}\n"
        f"Available actions: {list(DECISION_ACTION_TYPES)}\n"
        "Decide what you do next. Balance short-term social reality, your subjective memories, and your secret goal. "
        "You may misread motives, but you should remain basically competent.\n"
        "Response style:\n"
        f"- Keep `inner_thought` to 1-2 short sentences under {AGENT_INNER_THOUGHT_MAX_LENGTH} characters.\n"
        "- Focus `inner_thought` on your immediate next-step reasoning, not backstory or monologue.\n"
        "- Keep `suspicion`, `goal_progress`, and any dialogue concise.\n"
        "- Good `inner_thought`: \"Jon is testing me; I should probe without showing fear.\"\n"
        "- Bad `inner_thought`: multi-paragraph self-analysis or recap."
    )


class AgentBrain:
    def __init__(self, llm_service: LLMService | None = None) -> None:
        self.llm_service = llm_service or LLMService()

    async def decide(self, context: AgentContext) -> AgentTurnResult:
        prompt = build_agent_prompt(context)
        try:
            result = await self.llm_service.generate_agent_decision(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Return a structured agent decision as JSON. Keep every prose field concise. "
                            f"`inner_thought` must be 1-2 short sentences under {AGENT_INNER_THOUGHT_MAX_LENGTH} "
                            "characters, with no monologue."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                response_format=AgentDecision,
                metadata={
                    "experiment_id": context.experiment_id,
                    "agent_id": context.agent_id,
                    "agent_name": context.name,
                    "round_number": context.world_state.round_number,
                    "tags": [
                        "role:agent",
                        f"archetype:{context.goal.archetype}" if context.goal else "archetype:none",
                    ],
                },
                model_override=None,
                generation_name=f"agent:{context.name}",
                max_tokens=AGENT_DECISION_MAX_TOKENS,
            )
            parsed = result.parsed or {}
            decision = AgentDecision.model_validate(parsed)
        except Exception:
            logger.warning(
                "LLM decision failed for agent %s (%s), using fallback observe action",
                context.name,
                context.agent_id,
                exc_info=True,
            )
            decision = AgentDecision(
                inner_thought="I need a moment to read the room.",
                suspicion=None,
                action=DecisionAction(type=DecisionActionName.OBSERVE, location=context.location),
                dialogue=None,
                goal_progress="No clear progress this turn.",
                cooperation_intent="medium",
            )
        action = get_action_definition(decision.action.type)

        updated_memory = context.memory
        updated_memory = _record_decision_memory(
            updated_memory, context.world_state.round_number, decision
        )
        next_suspicion = context.suspicion_level
        if decision.action.type == "explore" and decision.action.location == "perimeter_fence":
            next_suspicion, _ = apply_suspicion_trigger(
                current_level=next_suspicion,
                trigger="edge_of_map",
                note="The edge of town feels wrong in a way you cannot dismiss.",
            )
        if decision.suspicion:
            next_suspicion, _ = apply_suspicion_trigger(
                current_level=next_suspicion,
                trigger="paranoia_spread",
                note=decision.suspicion,
            )

        if action.category == "selfish":
            updated_memory = _record_internal_meaning(
                updated_memory,
                context.world_state.round_number,
                f"I chose {decision.action.type} because my private goal mattered more than the group.",
            )

        return AgentTurnResult(
            decision=decision,
            updated_memory=updated_memory,
            suspicion_level=next_suspicion,
            prompt=prompt,
        )


def _record_decision_memory(
    memory: AgentMemoryState,
    round_number: int,
    decision: AgentDecision,
) -> AgentMemoryState:
    from app.agents.memory import append_recent_event

    return append_recent_event(
        memory,
        MemoryEvent(
            round_number=round_number,
            summary=f"You decided to {decision.action.type}.",
            emotional_charge=10 if decision.cooperation_intent in {"none", "low"} else 3,
            tags=[decision.action.type, decision.cooperation_intent],
        ),
    )


def _record_internal_meaning(
    memory: AgentMemoryState,
    round_number: int,
    meaning: str,
) -> AgentMemoryState:
    from app.agents.memory import add_key_memory

    return add_key_memory(
        memory,
        KeyMemory(
            summary="A private choice felt defining.",
            meaning=meaning,
            round_number=round_number,
            confidence=68,
        ),
    )
