from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.api.models import ApproveGMPlanRequest, ReviseGMPlanRequest
from app.api.runtime import GMPlanRevisionError
from app.gm.models import GMPlanRecord

from .support import _runtime_from_request

router = APIRouter(tags=["experiments"])


@router.get(
    "/{experiment_id}/gm/plan",
    summary="Get the next GM plan",
    description=(
        "Generate the next pending GM plan if needed, or return the cached plan for the "
        "upcoming round."
    ),
)
async def get_gm_plan(experiment_id: str, request: Request) -> GMPlanRecord:
    runtime = _runtime_from_request(request)
    try:
        return await runtime.get_or_generate_gm_plan(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


@router.post(
    "/{experiment_id}/gm/approve",
    summary="Approve or modify a GM plan",
    description=(
        "Approve the pending GM plan as-is, or submit a modified plan payload to apply " "instead."
    ),
)
async def approve_gm_plan(
    experiment_id: str,
    request: Request,
    body: ApproveGMPlanRequest,
) -> GMPlanRecord:
    runtime = _runtime_from_request(request)
    try:
        return await runtime.approve_gm_plan(experiment_id, body.modified_plan)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


@router.post(
    "/{experiment_id}/gm/revise",
    summary="Revise the next GM plan from feedback",
    description=(
        "Generate or load the upcoming GM plan, revise the full draft from free-text feedback, "
        "and persist the revised pending plan for preview before approval."
    ),
)
async def revise_gm_plan(
    experiment_id: str,
    request: Request,
    body: ReviseGMPlanRequest,
) -> GMPlanRecord:
    runtime = _runtime_from_request(request)
    try:
        return await runtime.revise_gm_plan(experiment_id, body.feedback)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc
    except GMPlanRevisionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
