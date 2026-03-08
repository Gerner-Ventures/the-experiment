from __future__ import annotations

from fastapi import APIRouter, Request

from app.api.models import (
    AnalyticsSummary,
    BetrayalAnalytics,
    FactionAnalytics,
    GMTimelinePage,
    GoalAnalytics,
    RelationshipAnalytics,
    RoundAnalyticsPage,
    SuspicionAnalytics,
)

from .support import _get_state, _runtime_from_request

router = APIRouter(tags=["experiments"])


@router.get(
    "/{experiment_id}/analytics/summary",
    response_model=AnalyticsSummary,
    summary="Get experiment analytics summary",
    description=(
        "Return a high-level analytics snapshot including rounds completed, active and "
        "exiled agents, faction counts, resources, threat, and cooperation score."
    ),
)
async def get_analytics_summary(experiment_id: str, request: Request) -> AnalyticsSummary:
    runtime = _runtime_from_request(request)
    state = await _get_state(runtime, experiment_id)
    return await runtime.get_analytics_summary(experiment_id, state=state)


@router.get(
    "/{experiment_id}/analytics/rounds",
    response_model=RoundAnalyticsPage,
    summary="Get round analytics",
    description="Return round-level report data including cooperation, betrayal counts, and GM narration.",
)
async def get_round_analytics(experiment_id: str, request: Request) -> RoundAnalyticsPage:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    return RoundAnalyticsPage(items=await runtime.get_round_analytics(experiment_id))


@router.get(
    "/{experiment_id}/analytics/goals",
    response_model=GoalAnalytics,
    summary="Get goal analytics",
    description="Return per-agent goal progress history and a derived final outcome summary.",
)
async def get_goal_analytics(experiment_id: str, request: Request) -> GoalAnalytics:
    runtime = _runtime_from_request(request)
    state = await _get_state(runtime, experiment_id)
    return GoalAnalytics(items=await runtime.get_goal_analytics(experiment_id, state=state))


@router.get(
    "/{experiment_id}/analytics/betrayals",
    response_model=BetrayalAnalytics,
    summary="Get betrayal analytics",
    description="Return sabotage, hostile-action, and exile timeline entries.",
)
async def get_betrayal_analytics(experiment_id: str, request: Request) -> BetrayalAnalytics:
    runtime = _runtime_from_request(request)
    state = await _get_state(runtime, experiment_id)
    return BetrayalAnalytics(items=await runtime.get_betrayal_analytics(experiment_id, state=state))


@router.get(
    "/{experiment_id}/analytics/suspicion",
    response_model=SuspicionAnalytics,
    summary="Get suspicion analytics",
    description="Return the round-by-round suspicion heatmap and per-agent suspicion history.",
)
async def get_suspicion_analytics(experiment_id: str, request: Request) -> SuspicionAnalytics:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    return await runtime.get_suspicion_analytics(experiment_id)


@router.get(
    "/{experiment_id}/analytics/relationships",
    response_model=RelationshipAnalytics,
    summary="Get relationship analytics",
    description="Return relationship edges derived from persisted agent relationship memory.",
)
async def get_relationship_analytics(experiment_id: str, request: Request) -> RelationshipAnalytics:
    runtime = _runtime_from_request(request)
    state = await _get_state(runtime, experiment_id)
    return RelationshipAnalytics(
        items=await runtime.get_relationship_analytics(experiment_id, state=state)
    )


@router.get(
    "/{experiment_id}/analytics/factions",
    response_model=FactionAnalytics,
    summary="Get faction analytics",
    description="Return the current alliance/cult state plus faction pressure timeline and membership changes.",
)
async def get_faction_analytics(experiment_id: str, request: Request) -> FactionAnalytics:
    runtime = _runtime_from_request(request)
    state = await _get_state(runtime, experiment_id)
    return await runtime.get_faction_analytics(experiment_id, state=state)


@router.get(
    "/{experiment_id}/analytics/gm",
    response_model=GMTimelinePage,
    summary="Get GM timeline analytics",
    description="Return the round-by-round GM narration and crisis timeline.",
)
async def get_gm_timeline(experiment_id: str, request: Request) -> GMTimelinePage:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    return GMTimelinePage(items=await runtime.get_gm_timeline(experiment_id))
