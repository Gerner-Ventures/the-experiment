from __future__ import annotations

from fastapi import APIRouter, Request

from app.api.models import RuntimeLLMModeResponse, UpdateRuntimeLLMModeRequest
from app.api.routes.experiments.support import _runtime_from_request

router = APIRouter(prefix="/runtime", tags=["runtime"])


@router.get(
    "/llm-mode",
    summary="Get backend LLM mode",
    description=(
        "Return whether the running backend process is currently using live LLM calls or "
        "mock text generation. This mode is process-local and resets on restart."
    ),
    response_model=RuntimeLLMModeResponse,
)
async def get_llm_mode(request: Request) -> RuntimeLLMModeResponse:
    runtime = _runtime_from_request(request)
    return RuntimeLLMModeResponse.model_validate(runtime.get_llm_mode_status())


@router.put(
    "/llm-mode",
    summary="Set backend LLM mode",
    description=(
        "Toggle the running backend process between live LLM calls and mock text generation. "
        "Mock mode uses rule-based GM narration plus seeded mock agent thoughts/actions, "
        "and does not call external LLM providers."
    ),
    response_model=RuntimeLLMModeResponse,
)
async def set_llm_mode(
    payload: UpdateRuntimeLLMModeRequest,
    request: Request,
) -> RuntimeLLMModeResponse:
    runtime = _runtime_from_request(request)
    return RuntimeLLMModeResponse.model_validate(await runtime.set_llm_mode(payload.mode))
