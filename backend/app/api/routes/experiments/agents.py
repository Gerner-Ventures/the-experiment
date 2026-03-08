from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.engine import EngineAgentState

from .support import _get_state, _runtime_from_request

router = APIRouter(tags=["experiments"])


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
