from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.api.models import EventLogPage

from .support import _get_state, _runtime_from_request

router = APIRouter(tags=["experiments"])


@router.get(
    "/{experiment_id}/log",
    response_model=EventLogPage,
    summary="Query the event log",
    description="Paginate and filter experiment events by phase, event type, agent, and round number.",
)
async def get_event_log(
    experiment_id: str,
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    phase: str | None = None,
    event_type: str | None = None,
    agent_id: str | None = None,
    round_number: int | None = Query(default=None, ge=1),
) -> EventLogPage:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    items, total = await runtime.get_log(
        experiment_id,
        limit=limit,
        offset=offset,
        phase=phase,
        event_type=event_type,
        agent_id=agent_id,
        round_number=round_number,
    )
    return EventLogPage(items=items, total=total, limit=limit, offset=offset)
