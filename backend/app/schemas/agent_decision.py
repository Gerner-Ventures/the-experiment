from typing import Literal

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
CooperationIntent = Literal["high", "medium", "low", "none"]


class DecisionAction(APIModel):
    type: DecisionActionType
    target: str | None = None
    location: str | None = None


class Dialogue(APIModel):
    target: str
    message: str


class AgentDecision(APIModel):
    inner_thought: str
    suspicion: str | None = None
    action: DecisionAction
    dialogue: Dialogue | None = None
    goal_progress: str
    cooperation_intent: CooperationIntent
