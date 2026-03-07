from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.api.models import (
    AnalyticsSummary,
    ApproveGMPlanRequest,
    CreateExperimentRequest,
    EventLogPage,
    ExperimentDetail,
    FactionAnalytics,
    HighlightPage,
    PromptTracePage,
    RelationshipAnalytics,
    ReplayIndex,
    RoundSnapshotResponse,
    ExperimentSummary,
    ObserverEventRequest,
    StepResponse,
    UpdateArcRequest,
    UsageReport,
)
from app.api.runtime import runtime
from app.engine import EngineAgentState, SimulationState
from app.gm.models import GMPlanRecord
from app.schemas.ws_message import WSMessage

router = APIRouter(prefix="/experiments", tags=["experiments"])


@router.post("", response_model=ExperimentDetail)
async def create_experiment(request: CreateExperimentRequest) -> ExperimentDetail:
    state = await runtime.create_experiment(request)
    return _detail(state)


@router.get("/{experiment_id}", response_model=ExperimentDetail)
async def get_experiment(experiment_id: str) -> ExperimentDetail:
    state = await _get_state(experiment_id)
    return _detail(state)


@router.post("/{experiment_id}/start", response_model=ExperimentSummary)
async def start_experiment(experiment_id: str) -> ExperimentSummary:
    state = await runtime.start(experiment_id)
    return _summary(state)


@router.post("/{experiment_id}/pause", response_model=ExperimentSummary)
async def pause_experiment(experiment_id: str) -> ExperimentSummary:
    state = await runtime.pause(experiment_id)
    return _summary(state)


@router.post("/{experiment_id}/step", response_model=StepResponse)
async def step_experiment(experiment_id: str) -> StepResponse:
    await _get_state(experiment_id)
    round_result, state = await runtime.step(experiment_id)
    return StepResponse(round_result=round_result, experiment=_detail(state))


@router.post("/{experiment_id}/inject", response_model=ExperimentDetail)
async def inject_observer_event(
    experiment_id: str, request: ObserverEventRequest
) -> ExperimentDetail:
    state = await runtime.inject_observer_event(experiment_id, request.description)
    return _detail(state)


@router.get("/{experiment_id}/gm/plan")
async def get_gm_plan(experiment_id: str) -> GMPlanRecord:
    await _get_state(experiment_id)
    return await runtime.get_or_generate_gm_plan(experiment_id)


@router.post("/{experiment_id}/gm/approve")
async def approve_gm_plan(experiment_id: str, request: ApproveGMPlanRequest) -> GMPlanRecord:
    await _get_state(experiment_id)
    return await runtime.approve_gm_plan(experiment_id, request.modified_plan)


@router.put("/{experiment_id}/arc", response_model=ExperimentDetail)
async def update_arc(experiment_id: str, request: UpdateArcRequest) -> ExperimentDetail:
    state = await runtime.update_arc(experiment_id, request.arc)
    return _detail(state)


@router.get("/{experiment_id}/agents")
async def list_agents(experiment_id: str) -> list[EngineAgentState]:
    await _get_state(experiment_id)
    return await runtime.list_agents(experiment_id)


@router.get("/{experiment_id}/agents/{agent_id}/dossier")
async def get_agent_dossier(experiment_id: str, agent_id: str) -> EngineAgentState:
    await _get_state(experiment_id)
    try:
        return await runtime.get_agent(experiment_id, agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Agent not found") from exc


@router.get("/{experiment_id}/log", response_model=EventLogPage)
async def get_event_log(
    experiment_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    phase: str | None = None,
    event_type: str | None = None,
    agent_id: str | None = None,
    round_number: int | None = Query(default=None, ge=1),
) -> EventLogPage:
    await _get_state(experiment_id)
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


@router.get("/{experiment_id}/analytics/summary", response_model=AnalyticsSummary)
async def get_analytics_summary(experiment_id: str) -> AnalyticsSummary:
    await _get_state(experiment_id)
    return await runtime.get_analytics_summary(experiment_id)


@router.get("/{experiment_id}/analytics/relationships", response_model=RelationshipAnalytics)
async def get_relationship_analytics(experiment_id: str) -> RelationshipAnalytics:
    await _get_state(experiment_id)
    return RelationshipAnalytics(items=await runtime.get_relationship_analytics(experiment_id))


@router.get("/{experiment_id}/analytics/factions", response_model=FactionAnalytics)
async def get_faction_analytics(experiment_id: str) -> FactionAnalytics:
    state = await _get_state(experiment_id)
    return FactionAnalytics(items=state.factions)


@router.get("/{experiment_id}/analytics/highlights", response_model=HighlightPage)
async def get_highlights(experiment_id: str) -> HighlightPage:
    await _get_state(experiment_id)
    return HighlightPage(items=await runtime.get_highlights(experiment_id))


@router.get("/{experiment_id}/replay", response_model=ReplayIndex)
async def get_replay_index(experiment_id: str) -> ReplayIndex:
    await _get_state(experiment_id)
    return await runtime.get_replay_index(experiment_id)


@router.get(
    "/{experiment_id}/rounds/{round_number}/snapshot",
    response_model=RoundSnapshotResponse,
)
async def get_round_snapshot(experiment_id: str, round_number: int) -> RoundSnapshotResponse:
    await _get_state(experiment_id)
    try:
        return await runtime.get_round_snapshot(experiment_id, round_number)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Round snapshot not found") from exc


@router.get("/{experiment_id}/usage", response_model=UsageReport)
async def get_usage_report(
    experiment_id: str,
    round_number: int | None = Query(default=None, ge=1),
    agent_id: str | None = None,
) -> UsageReport:
    await _get_state(experiment_id)
    return await runtime.get_usage_report(
        experiment_id,
        round_number=round_number,
        agent_id=agent_id,
    )


@router.get("/{experiment_id}/usage/traces", response_model=PromptTracePage)
async def get_prompt_traces(
    experiment_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    round_number: int | None = Query(default=None, ge=1),
    agent_id: str | None = None,
    role: str | None = Query(default=None, pattern="^(gm|agent)$"),
) -> PromptTracePage:
    await _get_state(experiment_id)
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
    await _get_state(experiment_id)
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


async def _get_state(experiment_id: str) -> SimulationState:
    try:
        return await runtime.get_state(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


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
    )
