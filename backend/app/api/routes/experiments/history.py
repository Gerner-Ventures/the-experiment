from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from app.api.models import HighlightPage, HighlightScope, ReplayIndex, RoundSnapshotResponse

from .support import _get_state, _runtime_from_request

router = APIRouter(tags=["experiments"])


@router.get(
    "/{experiment_id}/highlights",
    response_model=HighlightPage,
    summary="Get experiment highlights",
    description=(
        "Return the ranked highlight reel for one round or the full game, derived from the "
        "persisted event log and round summaries."
    ),
)
async def get_highlights(
    experiment_id: str,
    request: Request,
    scope: HighlightScope = Query(default="game"),
    round_number: int | None = Query(default=None, alias="round", ge=1),
) -> HighlightPage:
    runtime = _runtime_from_request(request)
    state = await _get_state(runtime, experiment_id)
    if scope == "round" and round_number is None:
        raise HTTPException(status_code=422, detail="round is required when scope=round")
    if scope == "round" and round_number is not None and round_number > state.current_round:
        raise HTTPException(status_code=404, detail="Round highlights not found")
    return HighlightPage(
        scope=scope,
        round_number=round_number if scope == "round" else None,
        items=await runtime.get_highlights(
            experiment_id,
            scope=scope,
            round_number=round_number,
        ),
    )


@router.get(
    "/{experiment_id}/analytics/highlights",
    response_model=HighlightPage,
    summary="Get experiment highlights",
    description="Backward-compatible alias for the highlight reel endpoint.",
    include_in_schema=False,
)
async def get_analytics_highlights(
    experiment_id: str,
    request: Request,
    scope: HighlightScope = Query(default="game"),
    round_number: int | None = Query(default=None, alias="round", ge=1),
) -> HighlightPage:
    return await get_highlights(
        experiment_id=experiment_id,
        request=request,
        scope=scope,
        round_number=round_number,
    )


@router.get(
    "/{experiment_id}/replay",
    response_model=ReplayIndex,
    summary="Get replay index",
    description="Return a round-by-round replay index with summaries, threat levels, and highlights.",
)
async def get_replay_index(experiment_id: str, request: Request) -> ReplayIndex:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    return await runtime.get_replay_index(experiment_id)


@router.get(
    "/{experiment_id}/rounds/{round_number}/snapshot",
    response_model=RoundSnapshotResponse,
    summary="Get round snapshot",
    description="Return the stored world snapshot and event log entries for a completed round.",
)
async def get_round_snapshot(
    experiment_id: str,
    round_number: int,
    request: Request,
) -> RoundSnapshotResponse:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    try:
        return await runtime.get_round_snapshot(experiment_id, round_number)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Round snapshot not found") from exc
