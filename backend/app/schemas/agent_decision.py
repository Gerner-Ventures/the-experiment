from typing import Literal, cast

from pydantic import Field

from app.actions import DECISION_ACTION_IDS
from app.schemas.common import APIModel

DecisionActionType = Literal[
    "move",
    "gather",
    "repair",
    "trade",
    "talk",
    "hoard",
    "sabotage",
    "explore",
    "accuse",
    "vote",
    "rest",
    "observe",
    "attack",
    "threaten",
    "stab",
    "shoot",
    "poison",
    "dance",
    "pray",
    "rally",
    "mourn",
    "celebrate",
    "argue",
    "pee",
    "poop",
    "vomit",
    "sleep",
    "eat",
    "drink",
    "investigate",
    "monologue",
    "panic",
    "breakdown",
    "self_sacrifice",
]
DECISION_ACTION_TYPES: tuple[DecisionActionType, ...] = cast(
    tuple[DecisionActionType, ...], DECISION_ACTION_IDS
)
CooperationIntent = Literal["high", "medium", "low", "none"]

AGENT_INNER_THOUGHT_MAX_LENGTH = 160
AGENT_DECISION_MAX_TOKENS = 384


class DecisionAction(APIModel):
    type: DecisionActionType
    target: str | None = None
    location: str | None = None


class Dialogue(APIModel):
    target: str
    message: str


class AgentDecision(APIModel):
    inner_thought: str = Field(
        min_length=1,
        max_length=AGENT_INNER_THOUGHT_MAX_LENGTH,
        description=(
            "A brief window into the agent's immediate reasoning. Keep it to 1-2 short "
            "sentences and avoid monologues."
        ),
    )
    suspicion: str | None = None
    action: DecisionAction
    dialogue: Dialogue | None = None
    goal_progress: str
    cooperation_intent: CooperationIntent
