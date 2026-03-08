from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.api.models import PromptTracePage, UsageReport

from .support import _get_state, _runtime_from_request

router = APIRouter(tags=["experiments"])


@router.get(
    "/{experiment_id}/usage",
    response_model=UsageReport,
    summary="Get LLM usage report",
    description=(
        "Return aggregated LLM usage totals grouped by role, model, agent, and round, "
        "optionally filtered to one round or agent."
    ),
)
async def get_usage_report(
    experiment_id: str,
    request: Request,
    round_number: int | None = Query(default=None, ge=1),
    agent_id: str | None = None,
) -> UsageReport:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    return await runtime.get_usage_report(
        experiment_id,
        round_number=round_number,
        agent_id=agent_id,
    )


@router.get(
    "/{experiment_id}/usage/traces",
    response_model=PromptTracePage,
    summary="Get LLM prompt traces",
    description=(
        "Return paginated prompt-level usage records, optionally filtered by round, "
        "agent, and role."
    ),
)
async def get_prompt_traces(
    experiment_id: str,
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    round_number: int | None = Query(default=None, ge=1),
    agent_id: str | None = None,
    role: str | None = Query(default=None, pattern="^(gm|agent|memory)$"),
) -> PromptTracePage:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    items, total = await runtime.get_prompt_traces(
        experiment_id,
        limit=limit,
        offset=offset,
        round_number=round_number,
        agent_id=agent_id,
        role=role,
    )
    return PromptTracePage(items=items, total=total, limit=limit, offset=offset)
