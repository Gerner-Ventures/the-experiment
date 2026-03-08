from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.api.models import NarrationAudioMetadata
from app.api.runtime import ExperimentRuntime
from app.tts import NarrationAudioError

router = APIRouter(prefix="/experiments", tags=["experiments"])


@router.get(
    "/{experiment_id}/rounds/{round_number}/narration",
    response_model=NarrationAudioMetadata,
    summary="Get round narration metadata",
    description="Return narration text plus backend audio metadata for a round.",
)
async def get_round_narration(
    experiment_id: str,
    round_number: int,
    request: Request,
) -> NarrationAudioMetadata:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    try:
        return await runtime.get_narration_audio_metadata(experiment_id, round_number)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Round not found") from exc
    except NarrationAudioError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get(
    "/{experiment_id}/rounds/{round_number}/narration/audio",
    summary="Stream round narration audio",
    description="Stream ElevenLabs-generated narration audio for a round.",
)
async def get_round_narration_audio(
    experiment_id: str,
    round_number: int,
    request: Request,
) -> StreamingResponse:
    runtime = _runtime_from_request(request)
    await _get_state(runtime, experiment_id)
    try:
        content_type, stream = await runtime.get_narration_audio_stream(experiment_id, round_number)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Round not found") from exc
    except NarrationAudioError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return StreamingResponse(stream, media_type=content_type)


async def _get_state(runtime: ExperimentRuntime, experiment_id: str) -> object:
    try:
        return await runtime.get_state(experiment_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Experiment not found") from exc


def _runtime_from_request(request: Request) -> ExperimentRuntime:
    runtime = getattr(request.app.state, "runtime", None)
    if not isinstance(runtime, ExperimentRuntime):
        raise RuntimeError("app.state.runtime not configured")
    return runtime
