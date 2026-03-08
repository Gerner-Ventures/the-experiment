from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.schemas.ws_message import WSMessage

from .support import _get_state, _runtime_from_websocket

router = APIRouter(tags=["experiments"])


@router.websocket("/{experiment_id}/ws")
async def experiment_ws(experiment_id: str, websocket: WebSocket) -> None:
    runtime = _runtime_from_websocket(websocket)
    await _get_state(runtime, experiment_id)
    await runtime.connection_manager.connect(experiment_id, websocket)
    try:
        await websocket.send_json(
            WSMessage(
                type="connected",
                round=0,
                timestamp=datetime.now(UTC),
                data={"experiment_id": experiment_id},
            ).model_dump(mode="json")
        )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        runtime.connection_manager.disconnect(experiment_id, websocket)
