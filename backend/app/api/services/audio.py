from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Literal, cast

import structlog
from app.api.models import AgentSpeechAudioMetadata, NarrationAudioMetadata
from app.api.store import ExperimentStore
from app.api.ws_manager import ConnectionManager
from app.engine import SimulationState
from app.engine.models import PhaseResult
from app.gm.models import GMPlanRecord
from app.tts import NarrationAudioError, NarrationAudioRequest, NarrationTTSService

from .runtime_support import AgentSpeechEntry, round_summary_data, string_value

log = structlog.get_logger(__name__)


class RuntimeAudioService:
    def __init__(
        self,
        *,
        store: ExperimentStore,
        get_state: Callable[[str], Awaitable[SimulationState]],
        connection_manager: ConnectionManager,
        tts_service: NarrationTTSService | None,
        agent_speech_log: dict[str, list[AgentSpeechEntry]],
        message_builder: Callable[..., dict[str, Any]],
    ) -> None:
        self.store = store
        self.get_state = get_state
        self.connection_manager = connection_manager
        self.tts_service = tts_service
        self.agent_speech_log = agent_speech_log
        self.message_builder = message_builder

    async def get_narration_audio_metadata(
        self, experiment_id: str, round_number: int
    ) -> NarrationAudioMetadata:
        state = await self.get_state(experiment_id)
        text = await self._resolve_narration_text(experiment_id, round_number, state=state)
        if self.tts_service is None:
            return NarrationAudioMetadata(
                experiment_id=experiment_id,
                round_number=round_number,
                text=text,
                narration_id=None,
                voice_id="",
                model_id="",
                output_format="",
                status="unavailable",
                audio_url=None,
                cache_hit=False,
            )

        request = self.tts_service.build_request(
            experiment_id=experiment_id,
            round_number=round_number,
            text=text,
            map_name=state.world_state.map_name,
        )
        narration_id = self.tts_service.narration_id(request)
        status, cache_hit = await self.tts_service.get_status(request)
        audio_url: str | None = None
        if status != "unavailable":
            audio_url = self.tts_service.build_audio_url(
                experiment_id,
                round_number,
                narration_id=narration_id,
            )
        return NarrationAudioMetadata(
            experiment_id=experiment_id,
            round_number=round_number,
            text=text,
            narration_id=narration_id,
            voice_id=request.voice_id,
            model_id=request.model_id,
            output_format=request.output_format,
            status=cast(Literal["pending", "ready", "unavailable"], status),
            audio_url=audio_url,
            cache_hit=cache_hit,
        )

    async def get_narration_audio_stream(
        self,
        experiment_id: str,
        round_number: int,
        *,
        version: str | None = None,
    ) -> tuple[str, AsyncIterator[bytes], str]:
        request = await self._narration_audio_request(experiment_id, round_number)
        if self.tts_service is None:
            raise NarrationAudioError("Narration audio is not configured.", status_code=503)
        narration_id = self.tts_service.narration_id(request)
        if version is not None and version != narration_id:
            raise NarrationAudioError(
                "Narration audio version does not match the current narration.",
                status_code=409,
            )
        result = await self.tts_service.stream(request)
        log.info(
            "narration_audio_stream_requested",
            experiment_id=experiment_id,
            round_number=round_number,
            narration_hash=result.cache_key,
            voice_id=request.voice_id,
            model_id=request.model_id,
            output_format=request.output_format,
            cache_hit=result.cache_hit,
        )
        return result.content_type, result.stream, narration_id

    async def get_agent_speech_metadata(
        self,
        experiment_id: str,
        agent_id: str,
        round_number: int,
        index: int,
    ) -> AgentSpeechAudioMetadata:
        await self.get_state(experiment_id)
        entry = await self._find_agent_speech_entry(experiment_id, agent_id, round_number, index)
        if entry is None:
            raise KeyError(
                f"No speech entry for agent {agent_id} round {round_number} index {index}"
            )
        if self.tts_service is None:
            return AgentSpeechAudioMetadata(
                experiment_id=experiment_id,
                agent_id=agent_id,
                round_number=round_number,
                index=index,
                text=entry["text"],
                voice_id="",
                model_id="",
                output_format="",
                status="unavailable",
            )
        request = self.tts_service.build_speech_request(
            experiment_id=experiment_id,
            round_number=round_number,
            text=entry["text"],
            character_id=entry["character_id"],
        )
        status, cache_hit = await self.tts_service.get_status(request)
        audio_url: str | None = None
        if status == "ready":
            audio_url = self.tts_service.build_speech_audio_url(
                experiment_id, agent_id, round_number, index
            )
        return AgentSpeechAudioMetadata(
            experiment_id=experiment_id,
            agent_id=agent_id,
            round_number=round_number,
            index=index,
            text=entry["text"],
            voice_id=request.voice_id,
            model_id=request.model_id,
            output_format=request.output_format,
            status=cast(Literal["pending", "ready", "unavailable"], status),
            audio_url=audio_url,
            cache_hit=cache_hit,
        )

    async def get_agent_speech_audio_stream(
        self,
        experiment_id: str,
        agent_id: str,
        round_number: int,
        index: int,
    ) -> tuple[str, AsyncIterator[bytes]]:
        entry = await self._find_agent_speech_entry(experiment_id, agent_id, round_number, index)
        if entry is None:
            raise KeyError(
                f"No speech entry for agent {agent_id} round {round_number} index {index}"
            )
        if self.tts_service is None:
            raise NarrationAudioError("Narration audio is not configured.", status_code=503)
        request = self.tts_service.build_speech_request(
            experiment_id=experiment_id,
            round_number=round_number,
            text=entry["text"],
            character_id=entry["character_id"],
        )
        result = await self.tts_service.stream(request)
        log.info(
            "agent_speech_audio_stream_requested",
            experiment_id=experiment_id,
            agent_id=agent_id,
            round_number=round_number,
            index=index,
            cache_hit=result.cache_hit,
        )
        return result.content_type, result.stream

    async def prepare_agent_speech_audio(
        self,
        experiment_id: str,
        round_number: int,
        phase_result: PhaseResult,
        entries_to_prewarm: list[AgentSpeechEntry],
    ) -> None:
        if self.tts_service is None or not self.tts_service.configured:
            for entry in entries_to_prewarm:
                await self.connection_manager.broadcast(
                    experiment_id,
                    self.message_builder(
                        "agent_speech_audio",
                        round_number=round_number,
                        phase=phase_result.phase,
                        data={
                            "agent_id": entry["agent_id"],
                            "round": round_number,
                            "index": entry["index"],
                            "status": "unavailable",
                            "audio_url": None,
                        },
                    ),
                )
            return

        if not entries_to_prewarm:
            return

        tts_service = self.tts_service
        for entry in entries_to_prewarm:
            await self.connection_manager.broadcast(
                experiment_id,
                self.message_builder(
                    "agent_speech_audio",
                    round_number=round_number,
                    phase=phase_result.phase,
                    data={
                        "agent_id": entry["agent_id"],
                        "round": round_number,
                        "index": entry["index"],
                        "status": "pending",
                        "audio_url": None,
                    },
                ),
            )

        async def _prewarm_one(entry: AgentSpeechEntry) -> None:
            request = tts_service.build_speech_request(
                experiment_id=experiment_id,
                round_number=round_number,
                text=entry["text"],
                character_id=entry["character_id"],
            )
            try:
                await tts_service.prewarm(request)
                audio_url = tts_service.build_speech_audio_url(
                    experiment_id, entry["agent_id"], round_number, entry["index"]
                )
                await self.connection_manager.broadcast(
                    experiment_id,
                    self.message_builder(
                        "agent_speech_audio",
                        round_number=round_number,
                        phase=phase_result.phase,
                        data={
                            "agent_id": entry["agent_id"],
                            "round": round_number,
                            "index": entry["index"],
                            "status": "ready",
                            "audio_url": audio_url,
                        },
                    ),
                )
            except NarrationAudioError as exc:
                log.warning(
                    "agent_speech_audio_prewarm_failed",
                    experiment_id=experiment_id,
                    agent_id=entry["agent_id"],
                    round_number=round_number,
                    index=entry["index"],
                    error=str(exc),
                )
                await self.connection_manager.broadcast(
                    experiment_id,
                    self.message_builder(
                        "agent_speech_audio",
                        round_number=round_number,
                        phase=phase_result.phase,
                        data={
                            "agent_id": entry["agent_id"],
                            "round": round_number,
                            "index": entry["index"],
                            "status": "error",
                            "audio_url": None,
                        },
                    ),
                )

        async def _prewarm_all() -> None:
            await asyncio.gather(
                *[_prewarm_one(entry) for entry in entries_to_prewarm], return_exceptions=True
            )

        asyncio.create_task(_prewarm_all())

    async def prepare_narration_audio(
        self,
        experiment_id: str,
        gm_plan: GMPlanRecord | None,
    ) -> None:
        if gm_plan is None or not gm_plan.plan.narration.strip():
            return
        if self.tts_service is None or not self.tts_service.configured:
            return
        request = await self._narration_audio_request(
            experiment_id,
            gm_plan.plan.round,
            narration_text=gm_plan.plan.narration,
        )
        await self.broadcast_narration_audio_status(experiment_id, request)
        tts_service = self.tts_service

        async def _prewarm() -> None:
            try:
                await tts_service.prewarm(request)
                await self.broadcast_narration_audio_status(experiment_id, request)
            except NarrationAudioError as exc:
                log.warning(
                    "narration_audio_prewarm_failed",
                    experiment_id=experiment_id,
                    round_number=request.round_number,
                    narration_hash=tts_service.cache_key(request),
                    error=str(exc),
                )
                await self.broadcast_narration_audio_status(
                    experiment_id,
                    request,
                    error=str(exc),
                )

        asyncio.create_task(_prewarm())

    async def broadcast_narration_audio_status_for_plan(
        self, experiment_id: str, gm_plan: GMPlanRecord
    ) -> None:
        if self.tts_service is None or not self.tts_service.configured:
            return
        if not gm_plan.plan.narration.strip():
            return
        request = await self._narration_audio_request(
            experiment_id,
            gm_plan.plan.round,
            narration_text=gm_plan.plan.narration,
        )
        await self.broadcast_narration_audio_status(experiment_id, request)

    async def broadcast_narration_audio_status(
        self,
        experiment_id: str,
        request: NarrationAudioRequest,
        *,
        error: str | None = None,
    ) -> None:
        if self.tts_service is None:
            return
        narration_id = self.tts_service.narration_id(request)
        if error is not None:
            await self.connection_manager.broadcast(
                experiment_id,
                self.message_builder(
                    "gm_audio_status",
                    round_number=request.round_number,
                    phase="gm_plan",
                    data={
                        "status": "error",
                        "error": error,
                        "narration_id": narration_id,
                    },
                ),
            )
            return
        status, _ = await self.tts_service.get_status(request)
        if status == "unavailable":
            await self.connection_manager.broadcast(
                experiment_id,
                self.message_builder(
                    "gm_audio_status",
                    round_number=request.round_number,
                    phase="gm_plan",
                    data={
                        "status": "error",
                        "error": "Narration audio is unavailable.",
                        "narration_id": narration_id,
                    },
                ),
            )
            return
        data: dict[str, Any] = {"status": status, "narration_id": narration_id}
        if status == "ready":
            data["audio_url"] = self.tts_service.build_audio_url(
                experiment_id,
                request.round_number,
                narration_id=narration_id,
            )
        await self.connection_manager.broadcast(
            experiment_id,
            self.message_builder(
                "gm_audio_status",
                round_number=request.round_number,
                phase="gm_plan",
                data=data,
            ),
        )

    async def _find_agent_speech_entry(
        self,
        experiment_id: str,
        agent_id: str,
        round_number: int,
        index: int,
    ) -> AgentSpeechEntry | None:
        for entry in self.agent_speech_log.get(experiment_id, []):
            if (
                entry["agent_id"] == agent_id
                and entry["round_number"] == round_number
                and entry["index"] == index
            ):
                return entry

        logs = await self.store.list_logs(experiment_id)
        character_map: dict[str, str] = {}
        try:
            state = await self.get_state(experiment_id)
            for agent in state.agents:
                character_map[agent.agent_id] = agent.character_id or ""
        except KeyError:
            pass

        agent_round_counts: dict[str, int] = {}
        for item in logs:
            if item.round_number != round_number:
                continue
            if item.data.get("kind") != "agent_speak":
                continue
            ev_agent_id = str(item.data.get("agent_id", ""))
            message_text = str(item.data.get("message", ""))
            if not ev_agent_id or not message_text.strip():
                continue
            current_index = agent_round_counts.get(ev_agent_id, 0)
            if ev_agent_id == agent_id and current_index == index:
                reconstructed: AgentSpeechEntry = {
                    "agent_id": ev_agent_id,
                    "character_id": character_map.get(ev_agent_id, ""),
                    "round_number": round_number,
                    "index": current_index,
                    "text": message_text,
                }
                self.agent_speech_log[experiment_id].append(reconstructed)
                return reconstructed
            agent_round_counts[ev_agent_id] = current_index + 1
        return None

    async def _narration_audio_request(
        self,
        experiment_id: str,
        round_number: int,
        *,
        state: SimulationState | None = None,
        narration_text: str | None = None,
    ) -> NarrationAudioRequest:
        if self.tts_service is None:
            raise NarrationAudioError("Narration audio is not configured.", status_code=503)
        resolved_state = state or await self.get_state(experiment_id)
        text = narration_text or await self._resolve_narration_text(
            experiment_id,
            round_number,
            state=resolved_state,
        )
        return self.tts_service.build_request(
            experiment_id=experiment_id,
            round_number=round_number,
            text=text,
            map_name=resolved_state.world_state.map_name,
        )

    async def _resolve_narration_text(
        self,
        experiment_id: str,
        round_number: int,
        *,
        state: SimulationState | None = None,
    ) -> str:
        resolved_state = state or await self.get_state(experiment_id)
        if round_number < 1 or round_number > resolved_state.total_rounds:
            raise KeyError(round_number)
        current_plan = resolved_state.gm_plan
        if (
            current_plan is not None
            and current_plan.plan.round == round_number
            and current_plan.plan.narration.strip()
        ):
            return current_plan.plan.narration

        round_summaries = round_summary_data(await self.store.list_logs(experiment_id))
        round_summary = round_summaries.get(round_number)
        narration = None
        if round_summary is not None:
            narration = string_value(round_summary.get("gm", {}).get("narration"))
        if narration:
            return narration
        raise NarrationAudioError(
            "Narration is not available for this round yet.",
            status_code=409,
        )
