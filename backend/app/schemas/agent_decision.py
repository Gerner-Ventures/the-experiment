from app.schemas.common import APIModel


class DecisionAction(APIModel):
    type: str
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
    cooperation_intent: str
