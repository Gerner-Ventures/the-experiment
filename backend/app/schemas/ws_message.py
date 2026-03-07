from datetime import datetime
from typing import Any

from app.schemas.common import APIModel


class WSMessage(APIModel):
    type: str
    round: int
    phase: str | None = None
    timestamp: datetime
    data: dict[str, Any]
