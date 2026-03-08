from __future__ import annotations

from fastapi import HTTPException, Request, WebSocket

from app.api.runtime import ExperimentRuntime
from app.engine import SimulationState


async def _get_state(runtime: ExperimentRuntime, experiment_id: str) -> SimulationState:
    try:
        return await runtime.get_state(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


def _runtime_from_request(request: Request) -> ExperimentRuntime:
    runtime = getattr(request.app.state, "runtime", None)
    if not isinstance(runtime, ExperimentRuntime):
        raise RuntimeError("app.state.runtime not configured")
    return runtime


def _runtime_from_websocket(websocket: WebSocket) -> ExperimentRuntime:
    runtime = getattr(websocket.app.state, "runtime", None)
    if not isinstance(runtime, ExperimentRuntime):
        raise RuntimeError("app.state.runtime not configured")
    return runtime
