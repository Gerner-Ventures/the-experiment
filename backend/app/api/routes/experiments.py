from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.schemas.common import APIModel

router = APIRouter(prefix="/experiments", tags=["experiments"])


class CreateExperimentRequest(APIModel):
    name: str = "Untitled Experiment"
    agents: list[dict[str, Any]]
    arc_id: str = "lord_of_the_flies"
    total_rounds: int = 15
    starting_resources: float = 100.0
    auto_approve: bool = False


class ExperimentSummary(APIModel):
    id: str
    name: str
    status: str
    current_round: int
    total_rounds: int
    threat_level: float
    agent_count: int


def _get_runner():
    from app.main import experiment_runner
    return experiment_runner


def _state_to_summary(state) -> ExperimentSummary:
    return ExperimentSummary(
        id=state.experiment_id,
        name=state.experiment_name,
        status=state.status,
        current_round=state.current_round,
        total_rounds=state.total_rounds,
        threat_level=state.world_state.threat_level,
        agent_count=len(state.agents),
    )


def _state_to_full(state) -> dict[str, Any]:
    return {
        "id": state.experiment_id,
        "name": state.experiment_name,
        "status": state.status,
        "currentRound": state.current_round,
        "totalRounds": state.total_rounds,
        "threatLevel": state.world_state.threat_level,
        "resources": state.world_state.resources.model_dump(),
        "agents": [
            {
                "id": a.agent_id,
                "name": a.name,
                "location": a.location,
                "suspicionLevel": a.suspicion_level,
                "personality": a.personality.model_dump(mode="json"),
                "goal": a.goal.model_dump(mode="json"),
                "inventory": a.inventory,
                "relationships": a.relationships,
                "memory": a.memory.model_dump(mode="json"),
            }
            for a in state.agents
        ],
        "arc": state.arc.model_dump(mode="json"),
        "worldState": state.world_state.model_dump(mode="json"),
    }


@router.post("", status_code=201)
async def create_experiment(req: CreateExperimentRequest) -> dict[str, Any]:
    runner = _get_runner()
    state = runner.create_experiment(
        name=req.name,
        agents=req.agents,
        arc_id=req.arc_id,
        total_rounds=req.total_rounds,
        starting_resources=req.starting_resources,
        auto_approve=req.auto_approve,
    )
    return _state_to_full(state)


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str) -> dict[str, Any]:
    runner = _get_runner()
    state = runner.get_experiment(experiment_id)
    if not state:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return _state_to_full(state)


@router.post("/{experiment_id}/start")
async def start_experiment(experiment_id: str) -> ExperimentSummary:
    runner = _get_runner()
    state = runner.get_experiment(experiment_id)
    if not state:
        raise HTTPException(status_code=404, detail="Experiment not found")
    state = runner.start_experiment(experiment_id)
    return _state_to_summary(state)


@router.post("/{experiment_id}/pause")
async def pause_experiment(experiment_id: str) -> ExperimentSummary:
    runner = _get_runner()
    state = runner.get_experiment(experiment_id)
    if not state:
        raise HTTPException(status_code=404, detail="Experiment not found")
    state = runner.pause_experiment(experiment_id)
    return _state_to_summary(state)


@router.post("/{experiment_id}/step")
async def step_round(experiment_id: str) -> dict[str, Any]:
    runner = _get_runner()
    state = runner.get_experiment(experiment_id)
    if not state:
        raise HTTPException(status_code=404, detail="Experiment not found")
    result = await runner.step_round(experiment_id)
    return {
        "round": result.round_number,
        "cooperationRatio": result.cooperation_ratio,
        "threatLevel": result.threat_level,
        "resources": result.world_state.resources.model_dump(),
        "phases": [p.phase for p in result.phases],
    }


@router.post("/{experiment_id}/approve-plan")
async def approve_plan(
    experiment_id: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    runner = _get_runner()
    state = runner.get_experiment(experiment_id)
    if not state:
        raise HTTPException(status_code=404, detail="Experiment not found")
    modified_plan = body.get("modifiedPlan") if body else None
    result = await runner.approve_plan(experiment_id, modified_plan=modified_plan)
    return {
        "round": result.round_number,
        "cooperationRatio": result.cooperation_ratio,
        "threatLevel": result.threat_level,
    }
