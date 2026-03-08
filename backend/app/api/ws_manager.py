from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder
from starlette.websockets import WebSocketState

from app.schemas.ws_message import WSMessage

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: defaultdict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, experiment_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.connections[experiment_id].add(ws)
        logger.info(
            "WS connected: experiment=%s (total=%d)",
            experiment_id,
            len(self.connections[experiment_id]),
        )

    def disconnect(self, experiment_id: str, ws: WebSocket) -> None:
        conns = self.connections.get(experiment_id)
        if conns is None:
            return
        conns.discard(ws)
        if not conns:
            self.connections.pop(experiment_id, None)
        logger.info(
            "WS disconnected: experiment=%s remaining=%d",
            experiment_id,
            len(self.connections.get(experiment_id, ())),
        )

    async def broadcast(self, experiment_id: str, msg: WSMessage | dict[str, Any]) -> None:
        conns = list(self.connections.get(experiment_id, ()))
        if not conns:
            return
        payload = msg.model_dump(mode="json") if isinstance(msg, WSMessage) else msg
        encoded_payload = jsonable_encoder(payload)
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_json(encoded_payload)
                else:
                    logger.warning(
                        "Pruning websocket during broadcast: experiment=%s state=%s",
                        experiment_id,
                        ws.client_state,
                    )
                    dead.append(ws)
            except Exception:
                logger.warning(
                    "Pruning websocket after send failure: experiment=%s",
                    experiment_id,
                    exc_info=True,
                )
                dead.append(ws)
        for ws in dead:
            self.disconnect(experiment_id, ws)
