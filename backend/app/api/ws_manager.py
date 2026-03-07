from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from app.schemas.ws_message import WSMessage

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, experiment_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.setdefault(experiment_id, []).append(ws)
        logger.info(
            "WS connected: experiment=%s (total=%d)",
            experiment_id,
            len(self._connections[experiment_id]),
        )

    def disconnect(self, experiment_id: str, ws: WebSocket) -> None:
        conns = self._connections.get(experiment_id, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(experiment_id, None)
        logger.info("WS disconnected: experiment=%s", experiment_id)

    async def broadcast(self, experiment_id: str, msg: WSMessage) -> None:
        conns = self._connections.get(experiment_id, [])
        if not conns:
            return
        payload = msg.model_dump(mode="json")
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(experiment_id, ws)

    async def send_event(
        self,
        experiment_id: str,
        msg_type: str,
        round_number: int,
        data: dict[str, Any],
        phase: str | None = None,
    ) -> None:
        msg = WSMessage(
            type=msg_type,
            round=round_number,
            phase=phase,
            timestamp=datetime.now(UTC),
            data=data,
        )
        await self.broadcast(experiment_id, msg)

    def has_connections(self, experiment_id: str) -> bool:
        return bool(self._connections.get(experiment_id))
