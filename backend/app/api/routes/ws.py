from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)


def _get_ws_manager():
    from app.main import ws_manager
    return ws_manager


def _get_runner():
    from app.main import experiment_runner
    return experiment_runner


@router.websocket("/experiments/{experiment_id}/ws")
async def experiment_websocket(websocket: WebSocket, experiment_id: str) -> None:
    manager = _get_ws_manager()
    runner = _get_runner()

    state = runner.get_experiment(experiment_id)
    if not state:
        await websocket.close(code=4004, reason="Experiment not found")
        return

    await manager.connect(experiment_id, websocket)

    try:
        # Send initial state snapshot
        from app.api.routes.experiments import _state_to_full
        await websocket.send_json({
            "type": "snapshot",
            "data": _state_to_full(state),
        })

        # Keep connection alive, listen for client messages
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("WS client disconnected: experiment=%s", experiment_id)
    except Exception:
        logger.exception("WS error: experiment=%s", experiment_id)
    finally:
        manager.disconnect(experiment_id, websocket)
