from __future__ import annotations

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from app.api.runtime import ExperimentRuntime
from app.db import engine
from app.db.models import Experiment, ExperimentStatus

# NOTE: This endpoint is intentionally unauthenticated so that k8s HPA
# scrapers and external monitoring tools can poll it without credentials.
# It exposes only aggregate operational counters, no PII or experiment content.
router = APIRouter(tags=["metrics"])


@router.get(
    "/metrics",
    summary="Application metrics",
    description="Returns runtime metrics: active experiments, rounds processed, WebSocket connections.",
)
async def metrics(request: Request) -> dict[str, object]:
    runtime = getattr(request.app.state, "runtime", None)
    if not isinstance(runtime, ExperimentRuntime):
        raise RuntimeError("app.state.runtime not configured")

    async with engine.connect() as conn:
        total_row = await conn.execute(select(func.count()).select_from(Experiment))
        experiments_total = total_row.scalar() or 0

        active_row = await conn.execute(
            select(func.count())
            .select_from(Experiment)
            .where(Experiment.status == ExperimentStatus.RUNNING)
        )
        experiments_active = active_row.scalar() or 0

        rounds_row = await conn.execute(
            select(func.coalesce(func.sum(Experiment.current_round), 0)).select_from(Experiment)
        )
        rounds_processed = rounds_row.scalar() or 0

    ws_connections = sum(
        len(sockets) for sockets in runtime.connection_manager.connections.values()
    )

    return {
        "experiments_total": experiments_total,
        "experiments_active": experiments_active,
        "rounds_processed": rounds_processed,
        "websocket_connections": ws_connections,
    }
