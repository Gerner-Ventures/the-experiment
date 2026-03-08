from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

from app.api.models import (
    AnalyticsSummary,
    ApproveGMPlanRequest,
    BetrayalAnalytics,
    CreateExperimentRequest,
    EventLogPage,
    ExperimentDetail,
    FactionAnalytics,
    GMTimelinePage,
    GoalAnalytics,
    HighlightPage,
    PromptTracePage,
    RelationshipAnalytics,
    ReplayIndex,
    RoundAnalyticsPage,
    RoundSnapshotResponse,
    ExperimentSummary,
    ObserverEventRequest,
    SuspicionAnalytics,
    StepStartedResponse,
    UpdateArcRequest,
    UsageReport,
)
from app.api.runtime import ExperimentRuntime
from app.engine import EngineAgentState, SimulationState
from app.gm.models import GMPlanRecord
from app.schemas.ws_message import WSMessage

router = APIRouter(prefix="/experiments", tags=["experiments"])


@router.post(
    "",
    response_model=ExperimentDetail,
    summary="Create an experiment",
    description=(
        "Create a new experiment, persist its initial state, and return the starting "
        "world, agents, and arc configuration."
    ),
)
async def create_experiment(request: Request, body: CreateExperimentRequest) -> ExperimentDetail:
    runtime = _runtime_from_request(request)
    state = await runtime.create_experiment(body)
    return _detail(state)


@router.get(
    "/{experiment_id}",
    response_model=ExperimentDetail,
    summary="Get experiment state",
    description="Fetch the current experiment state, including agents, world state, and GM plan.",
)
async def get_experiment(experiment_id: str, request: Request) -> ExperimentDetail:
    runtime = _runtime_from_request(request)
    state = await _get_state(runtime, experiment_id)
    return _detail(state)


@router.post(
    "/{experiment_id}/start",
    response_model=ExperimentSummary,
    summary="Start an experiment",
    description="Transition an experiment from setup or pause into the running state.",
)
async def start_experiment(experiment_id: str, request: Request) -> ExperimentSummary:
    runtime = _runtime_from_request(request)
    try:
        return _summary(await runtime.start(experiment_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


@router.post(
    "/{experiment_id}/pause",
    response_model=ExperimentSummary,
    summary="Pause an experiment",
    description="Pause the active experiment without mutating the current round state.",
)
async def pause_experiment(experiment_id: str, request: Request) -> ExperimentSummary:
    runtime = _runtime_from_request(request)
    try:
        return _summary(await runtime.pause(experiment_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


@router.post(
    "/{experiment_id}/step",
    response_model=StepStartedResponse,
    summary="Advance one round",
    description="Start a simulation round in the background. Results stream over WebSocket.",
)
async def step_experiment(experiment_id: str, request: Request) -> StepStartedResponse:
    runtime = _runtime_from_request(request)
    try:
        state = await runtime.get_state(experiment_id)
        runtime.start_step(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc
    except RuntimeError:
        raise HTTPException(status_code=409, detail="A round is already in progress")
    return StepStartedResponse(
        round_number=state.current_round + 1,
        experiment_id=experiment_id,
    )


@router.post(
    "/{experiment_id}/inject",
    response_model=ExperimentDetail,
    summary="Inject an observer event",
    description="Append an out-of-band observer event that raises tension inside the experiment.",
)
async def inject_observer_event(
    experiment_id: str,
    request: Request,
    body: ObserverEventRequest,
) -> ExperimentDetail:
    runtime = _runtime_from_request(request)
    try:
        return _detail(await runtime.inject_observer_event(experiment_id, body.description))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


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


@router.put(
    "/{experiment_id}/arc",
    response_model=ExperimentDetail,
    summary="Replace the active narrative arc",
    description="Swap the current director arc for a new one while the experiment is in progress.",
)
async def update_arc(
    experiment_id: str,
    request: Request,
    body: UpdateArcRequest,
) -> ExperimentDetail:
    runtime = _runtime_from_request(request)
    try:
        return _detail(await runtime.update_arc(experiment_id, body.arc))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


@router.get(
    "/{experiment_id}/agents",
    summary="List experiment agents",
    description="Return the current state for every agent participating in the experiment.",
)
async def list_agents(experiment_id: str, request: Request) -> list[EngineAgentState]:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    return await runtime.list_agents(experiment_id)


@router.get(
    "/{experiment_id}/agents/{agent_id}/dossier",
    summary="Get an agent dossier",
    description="Return the detailed state for a single agent, including memory, relationships, and status.",
)
async def get_agent_dossier(
    experiment_id: str, agent_id: str, request: Request
) -> EngineAgentState:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    try:
        return await runtime.get_agent(experiment_id, agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Agent not found") from exc


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


@router.get(
    "/{experiment_id}/analytics/highlights",
    response_model=HighlightPage,
    summary="Get experiment highlights",
    description="Return the highest-signal events derived from the persisted event log.",
)
async def get_highlights(experiment_id: str, request: Request) -> HighlightPage:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    return HighlightPage(items=await runtime.get_highlights(experiment_id))


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


async def _get_state(runtime: ExperimentRuntime, experiment_id: str) -> SimulationState:
    try:
        return await runtime.get_state(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


def _runtime_from_request(request: Request) -> ExperimentRuntime:
    runtime = getattr(request.app.state, "runtime", None)
    assert isinstance(runtime, ExperimentRuntime), "app.state.runtime not configured"
    return runtime


def _runtime_from_websocket(websocket: WebSocket) -> ExperimentRuntime:
    runtime = getattr(websocket.app.state, "runtime", None)
    assert isinstance(runtime, ExperimentRuntime), "app.state.runtime not configured"
    return runtime


def _summary(state: SimulationState) -> ExperimentSummary:
    return ExperimentSummary(
        experiment_id=state.experiment_id,
        experiment_name=state.experiment_name,
        status=state.status,
        current_round=state.current_round,
        total_rounds=state.total_rounds,
        auto_approve=state.auto_approve,
        world_state=state.world_state.model_dump(mode="json"),
    )


def _detail(state: SimulationState) -> ExperimentDetail:
    return ExperimentDetail(
        experiment_id=state.experiment_id,
        experiment_name=state.experiment_name,
        status=state.status,
        current_round=state.current_round,
        total_rounds=state.total_rounds,
        auto_approve=state.auto_approve,
        arc=state.arc,
        world_state=state.world_state.model_dump(mode="json"),
        agents=state.agents,
        gm_plan=state.gm_plan,
        unresolved_plotlines=state.unresolved_plotlines,
        factions=state.factions,
        exile_history=state.exile_history,
        sacrifice_history=state.sacrifice_history,
    )
