from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.api.models import (
    ApproveGMPlanRequest,
    CreateExperimentRequest,
    EventLogPage,
    ExperimentDetail,
    ExperimentSummary,
    ObserverEventRequest,
    StepResponse,
    UpdateArcRequest,
)
from app.api.runtime import runtime
from app.engine import EngineAgentState, SimulationState
from app.gm.models import GMPlanRecord
from app.schemas.ws_message import WSMessage

router = APIRouter(prefix="/experiments", tags=["experiments"])


@router.post(
    "",
    response_model=ExperimentDetail,
    summary="Create an experiment",
    description="Create a new in-memory experiment with agents, arc settings, and round limits.",
)
async def create_experiment(request: CreateExperimentRequest) -> ExperimentDetail:
    state = await runtime.create_experiment(request)
    return _detail(state)


@router.get(
    "/{experiment_id}",
    response_model=ExperimentDetail,
    summary="Get experiment state",
    description="Fetch the current experiment state, including agents, world state, and GM plan.",
)
async def get_experiment(experiment_id: str) -> ExperimentDetail:
    state = _get_state(experiment_id)
    return _detail(state)


@router.post(
    "/{experiment_id}/start",
    response_model=ExperimentSummary,
    summary="Start an experiment",
    description="Transition an experiment from setup or pause into the running state.",
)
async def start_experiment(experiment_id: str) -> ExperimentSummary:
    state = _get_state(experiment_id)
    runtime.start(experiment_id)
    return _summary(state)


@router.post(
    "/{experiment_id}/pause",
    response_model=ExperimentSummary,
    summary="Pause an experiment",
    description="Pause the active experiment without mutating the current round state.",
)
async def pause_experiment(experiment_id: str) -> ExperimentSummary:
    state = runtime.pause(experiment_id)
    return _summary(state)


@router.post(
    "/{experiment_id}/step",
    response_model=StepResponse,
    summary="Advance one round",
    description="Run exactly one simulation round and return both the round result and refreshed state.",
)
async def step_experiment(experiment_id: str) -> StepResponse:
    _get_state(experiment_id)
    round_result, state = await runtime.step(experiment_id)
    return StepResponse(round_result=round_result, experiment=_detail(state))


@router.post(
    "/{experiment_id}/inject",
    response_model=ExperimentDetail,
    summary="Inject an observer event",
    description="Append an out-of-band observer event that raises tension inside the experiment.",
)
async def inject_observer_event(
    experiment_id: str, request: ObserverEventRequest
) -> ExperimentDetail:
    state = runtime.inject_observer_event(experiment_id, request.description)
    return _detail(state)


@router.get(
    "/{experiment_id}/gm/plan",
    summary="Get the next GM plan",
    description="Generate the next pending GM plan if needed, or return the cached plan for the upcoming round.",
)
async def get_gm_plan(experiment_id: str) -> GMPlanRecord:
    _get_state(experiment_id)
    return await runtime.get_or_generate_gm_plan(experiment_id)


@router.post(
    "/{experiment_id}/gm/approve",
    summary="Approve or modify a GM plan",
    description="Approve the pending GM plan as-is, or submit a modified plan payload to apply instead.",
)
async def approve_gm_plan(experiment_id: str, request: ApproveGMPlanRequest) -> GMPlanRecord:
    _get_state(experiment_id)
    return await runtime.approve_gm_plan(experiment_id, request.modified_plan)


@router.put(
    "/{experiment_id}/arc",
    response_model=ExperimentDetail,
    summary="Replace the active narrative arc",
    description="Swap the current director arc for a new one while the experiment is in progress.",
)
async def update_arc(experiment_id: str, request: UpdateArcRequest) -> ExperimentDetail:
    state = runtime.update_arc(experiment_id, request.arc)
    return _detail(state)


@router.get(
    "/{experiment_id}/agents",
    summary="List experiment agents",
    description="Return the current state for every agent participating in the experiment.",
)
async def list_agents(experiment_id: str) -> list[EngineAgentState]:
    _get_state(experiment_id)
    return runtime.list_agents(experiment_id)


@router.get(
    "/{experiment_id}/agents/{agent_id}/dossier",
    summary="Get an agent dossier",
    description="Return the detailed state for a single agent, including memory, relationships, and status.",
)
async def get_agent_dossier(experiment_id: str, agent_id: str) -> EngineAgentState:
    _get_state(experiment_id)
    try:
        return runtime.get_agent(experiment_id, agent_id)
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
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    phase: str | None = None,
    event_type: str | None = None,
    agent_id: str | None = None,
    round_number: int | None = Query(default=None, ge=1),
) -> EventLogPage:
    _get_state(experiment_id)
    items, total = runtime.get_log(
        experiment_id,
        limit=limit,
        offset=offset,
        phase=phase,
        event_type=event_type,
        agent_id=agent_id,
        round_number=round_number,
    )
    return EventLogPage(items=items, total=total, limit=limit, offset=offset)


@router.websocket("/{experiment_id}/ws")
async def experiment_ws(experiment_id: str, websocket: WebSocket) -> None:
    _get_state(experiment_id)
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


def _get_state(experiment_id: str) -> SimulationState:
    try:
        return runtime.get_state(experiment_id)
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
    )
