from datetime import datetime
from typing import Any, Literal

from app.schemas.common import APIModel

WSMessageType = Literal[
    "connected",
    "round_start",
    "round_end",
    "phase_change",
    "gm_plan",
    "gm_narration",
    "agent_action",
    "agent_move",
    "agent_speak",
    "crisis_event",
    "meeting_start",
    "meeting_speech",
    "meeting_vote",
    "meeting_result",
    "faction_update",
    "cult_activity",
    "exile_vote",
    "exile_result",
    "threat_update",
    "resource_update",
    "observer_event",
    "experiment_end",
]


class WSMessage(APIModel):
    type: WSMessageType
    round: int
    phase: str | None = None
    timestamp: datetime
    data: dict[str, Any]
