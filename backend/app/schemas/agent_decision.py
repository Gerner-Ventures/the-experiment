from typing import Literal, cast

from pydantic import Field

from app.actions import DecisionActionName
from app.schemas.common import APIModel

DecisionActionType = DecisionActionName
DECISION_ACTION_TYPES: tuple[DecisionActionType, ...] = cast(
    tuple[DecisionActionType, ...], tuple(DecisionActionName)
)
CooperationIntent = Literal["high", "medium", "low", "none"]

AGENT_INNER_THOUGHT_MAX_LENGTH = 300
AGENT_DECISION_MAX_TOKENS = 2048


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
