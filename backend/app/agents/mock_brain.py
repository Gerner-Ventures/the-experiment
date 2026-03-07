"""Rule-based mock agent brain for testing without LLM keys."""

from __future__ import annotations

import random
from typing import cast

from app.agents.brain import AgentBrain
from app.agents.models import (
    ACTION_TYPES,
    AgentContext,
    AgentTurnResult,
    KeyMemory,
    MemoryEvent,
)
from app.agents.memory import add_key_memory, append_recent_event
from app.agents.suspicion import apply_suspicion_trigger
from app.schemas.agent_decision import AgentDecision, DecisionAction, DecisionActionType, Dialogue

# Weighted by personality
COOPERATIVE_ACTIONS = ("gather", "repair", "trade", "talk", "rest", "observe")
SELFISH_ACTIONS = ("hoard", "sabotage", "explore", "accuse")
NON_TERMINAL_ACTIONS = tuple(action for action in ACTION_TYPES if action != "self_sacrifice")

LOCATIONS = (
    "town_square",
    "general_store",
    "water_well",
    "workshop",
    "farm_field",
    "meeting_hall",
    "perimeter_fence",
)

DIALOGUE_TEMPLATES = [
    "I think we should work together on this.",
    "Something doesn't feel right about this place.",
    "Have you noticed anything strange?",
    "We need to be more careful with our resources.",
    "I don't trust what's happening here.",
    "Let's focus on survival for now.",
    "Who do you think is really in charge?",
    "I have a bad feeling about tonight.",
]


class MockAgentBrain(AgentBrain):
    """Returns plausible decisions based on personality axes without calling any LLM."""

    async def decide(self, context: AgentContext) -> AgentTurnResult:
        axes = context.personality.axes
        rng = random.Random(hash((context.agent_id, context.world_state.round_number)))

        # Higher empathy/loyalty → cooperative, higher dominance/ambition → selfish
        coop_weight = (axes.empathy + axes.loyalty) / 200
        selfish_weight = (axes.dominance + axes.ambition + axes.impulsiveness) / 300

        if rng.random() < coop_weight * 0.7:
            action_type = cast(DecisionActionType, rng.choice(COOPERATIVE_ACTIONS))
        elif rng.random() < selfish_weight * 0.5:
            action_type = cast(DecisionActionType, rng.choice(SELFISH_ACTIONS))
        else:
            action_type = rng.choice(NON_TERMINAL_ACTIONS)

        location = rng.choice(LOCATIONS)

        # Sometimes generate dialogue
        dialogue = None
        if action_type in ("talk", "trade", "accuse") or rng.random() < 0.3:
            dialogue = Dialogue(
                target=rng.choice(["town", "group", "self"]),
                message=rng.choice(DIALOGUE_TEMPLATES),
            )

        # Suspicion-based inner thoughts
        inner_thoughts = [
            f"I need to focus on my goal: {context.goal.text[:50]}...",
            "Something about this town is deeply unsettling.",
            "I should build more alliances before it's too late.",
            "Resources are getting scarce. I need to act now.",
            "Can I really trust the people around me?",
        ]
        inner_thought = rng.choice(inner_thoughts)

        suspicion_text = None
        if context.suspicion_level > 30 or axes.paranoia > 60:
            suspicion_text = "The edges of this reality feel thin."

        decision = AgentDecision(
            inner_thought=inner_thought,
            suspicion=suspicion_text,
            action=DecisionAction(
                type=action_type,
                target=None,
                location=location,
            ),
            dialogue=dialogue,
            goal_progress=f"Working toward: {context.goal.archetype}",
            cooperation_intent="high" if action_type in COOPERATIVE_ACTIONS else "low",
        )

        # Update memory
        updated_memory = append_recent_event(
            context.memory,
            MemoryEvent(
                round_number=context.world_state.round_number,
                summary=f"You decided to {action_type} at {location}.",
                emotional_charge=5,
                tags=[action_type],
            ),
        )

        next_suspicion = context.suspicion_level
        if action_type == "explore" and location == "perimeter_fence":
            next_suspicion, _ = apply_suspicion_trigger(
                current_level=next_suspicion,
                trigger="edge_of_map",
                note="The edge feels wrong.",
            )
        if suspicion_text:
            next_suspicion, _ = apply_suspicion_trigger(
                current_level=next_suspicion,
                trigger="paranoia_spread",
                note=suspicion_text,
            )

        if action_type in SELFISH_ACTIONS:
            updated_memory = add_key_memory(
                updated_memory,
                KeyMemory(
                    summary=f"Chose {action_type} over the group.",
                    meaning="My private goal mattered more.",
                    round_number=context.world_state.round_number,
                    confidence=68,
                ),
            )

        return AgentTurnResult(
            decision=decision,
            updated_memory=updated_memory,
            suspicion_level=next_suspicion,
            prompt=f"[MOCK] {context.name} at {location}: {action_type}",
        )
