from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.api.models import (
    CreateExperimentRequest,
    ExperimentDetail,
    ExperimentSummary,
    ObserverEventRequest,
    StepStartedResponse,
    UpdateArcRequest,
)
from app.engine import SimulationState

from .support import _get_state, _runtime_from_request

router = APIRouter(tags=["experiments"])


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
