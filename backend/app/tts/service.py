from __future__ import annotations

import asyncio
import hashlib
import time
from collections import OrderedDict
from collections.abc import AsyncIterator
from typing import Protocol

import structlog

from app.core.config import CHARACTER_VOICE_IDS, MAP_NARRATOR_VOICE_IDS, Settings
from app.tts.elevenlabs import ElevenLabsNarrationProvider, NarrationAudioError
from app.tts.models import (
    CachedNarrationAudio,
    InflightNarrationAudio,
    NarrationAudioRequest,
    NarrationAudioStreamResult,
    ProviderAudioStream,
)

log = structlog.get_logger(__name__)


class NarrationAudioProvider(Protocol):
    async def start_stream(self, request: NarrationAudioRequest) -> ProviderAudioStream: ...

    async def aclose(self) -> None: ...


class NarrationTTSService:
    def __init__(
        self,
        settings: Settings,
        *,
        provider: NarrationAudioProvider | None = None,
        cache_ttl_seconds: int = 900,
        cache_max_entries: int = 16,
    ) -> None:
        self._settings = settings
        self._provider = provider or (
            ElevenLabsNarrationProvider(
                api_key=settings.elevenlabs_api_key,
                timeout_seconds=settings.elevenlabs_timeout_seconds,
            )
            if settings.elevenlabs_api_key
            else None
        )
        self._cache_ttl_seconds = cache_ttl_seconds
        self._cache_max_entries = cache_max_entries
        self._cache: OrderedDict[str, CachedNarrationAudio] = OrderedDict()
        self._cache_lock = asyncio.Lock()
        self._inflight: dict[str, InflightNarrationAudio] = {}

    @property
    def configured(self) -> bool:
        return self._provider is not None

    @property
    def voice_id(self) -> str:
        return self._settings.elevenlabs_voice_id

    @property
    def model_id(self) -> str:
        return self._settings.elevenlabs_model_id

    @property
    def output_format(self) -> str:
        return self._settings.elevenlabs_output_format

    async def aclose(self) -> None:
        if self._provider is not None:
            await self._provider.aclose()

    def build_request(
        self,
        *,
        experiment_id: str,
        round_number: int,
        text: str,
        map_name: str | None = None,
    ) -> NarrationAudioRequest:
        return NarrationAudioRequest(
            experiment_id=experiment_id,
            round_number=round_number,
            text=text,
            voice_id=self.voice_id_for_map(map_name),
            model_id=self.model_id,
            output_format=self.output_format,
            voice_settings=self._voice_settings(),
        )

    def build_audio_url(
        self,
        experiment_id: str,
        round_number: int,
        *,
        narration_id: str | None = None,
    ) -> str:
        url = f"/api/experiments/{experiment_id}/rounds/{round_number}/narration/audio"
        if narration_id:
            return f"{url}?v={narration_id}"
        return url

    def build_speech_request(
        self,
        *,
        experiment_id: str,
        round_number: int,
        text: str,
        character_id: str,
    ) -> NarrationAudioRequest:
        return NarrationAudioRequest(
            experiment_id=experiment_id,
            round_number=round_number,
            text=text,
            voice_id=self.voice_id_for_character(character_id),
            model_id=self.model_id,
            output_format=self.output_format,
            voice_settings=self._voice_settings(),
        )

    def build_speech_audio_url(
        self, experiment_id: str, agent_id: str, round_number: int, index: int
    ) -> str:
        return (
            f"/api/experiments/{experiment_id}/agents/{agent_id}"
            f"/speech/audio?round={round_number}&index={index}"
        )

    def voice_id_for_character(self, character_id: str) -> str:
        voice_id = CHARACTER_VOICE_IDS.get(character_id)
        if isinstance(voice_id, str) and voice_id.strip():
            return voice_id
        return self.voice_id

    def voice_id_for_map(self, map_name: str | None) -> str:
        if map_name:
            voice_id = MAP_NARRATOR_VOICE_IDS.get(map_name)
            if isinstance(voice_id, str) and voice_id.strip():
                return voice_id
        return self.voice_id

    def cache_key(self, request: NarrationAudioRequest) -> str:
        digest = hashlib.sha1()
        digest.update(request.experiment_id.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(str(request.round_number).encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(request.voice_id.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(request.model_id.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(request.output_format.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(request.text.encode("utf-8"))
        for key, value in sorted(request.voice_settings.items()):
            digest.update(b"\x1f")
            digest.update(key.encode("utf-8"))
            digest.update(b"=")
            digest.update(f"{value}".encode("utf-8"))
        return digest.hexdigest()

    def narration_id(self, request: NarrationAudioRequest) -> str:
        return self.cache_key(request)

    async def get_status(self, request: NarrationAudioRequest) -> tuple[str, bool]:
        if not self.configured:
            return "unavailable", False
        entry = await self._get_cache_entry(self.cache_key(request))
        return ("ready", True) if entry is not None else ("pending", False)

    async def stream(self, request: NarrationAudioRequest) -> NarrationAudioStreamResult:
        if not self.configured:
            raise NarrationAudioError("Narration audio is not configured.", status_code=503)
        cache_key = self.cache_key(request)
        entry = await self._get_cache_entry(cache_key)
        if entry is not None:
            return NarrationAudioStreamResult(
                cache_key=cache_key,
                content_type=entry.content_type,
                cache_hit=True,
                stream=self._iter_bytes(entry.audio_bytes),
            )

        async with self._cache_lock:
            entry = self._get_cached_no_lock(cache_key)
            if entry is not None:
                return NarrationAudioStreamResult(
                    cache_key=cache_key,
                    content_type=entry.content_type,
                    cache_hit=True,
                    stream=self._iter_bytes(entry.audio_bytes),
                )
            inflight = self._inflight.get(cache_key)
            if inflight is None:
                inflight = InflightNarrationAudio()
                self._inflight[cache_key] = inflight
                owner = True
            else:
                owner = False

        if not owner:
            await inflight.event.wait()
            if inflight.entry is not None:
                return NarrationAudioStreamResult(
                    cache_key=cache_key,
                    content_type=inflight.entry.content_type,
                    cache_hit=True,
                    stream=self._iter_bytes(inflight.entry.audio_bytes),
                )
            error = inflight.error or NarrationAudioError(
                "Narration audio generation failed.",
                status_code=502,
            )
            if isinstance(error, NarrationAudioError):
                raise error
            raise NarrationAudioError("Narration audio generation failed.", status_code=502)

        assert self._provider is not None
        try:
            provider_stream = await self._provider.start_stream(request)
        except Exception as exc:
            await self._finish_inflight(cache_key, error=exc)
            if isinstance(exc, NarrationAudioError):
                raise
            raise NarrationAudioError(
                "Narration audio generation failed.", status_code=502
            ) from exc

        return NarrationAudioStreamResult(
            cache_key=cache_key,
            content_type=provider_stream.content_type,
            cache_hit=False,
            stream=self._proxy_and_cache(
                cache_key=cache_key,
                request=request,
                provider_stream=provider_stream,
            ),
        )

    async def prewarm(self, request: NarrationAudioRequest) -> bool:
        result = await self.stream(request)
        if result.cache_hit:
            return True
        async for _ in result.stream:
            pass
        return True

    async def _get_cache_entry(self, cache_key: str) -> CachedNarrationAudio | None:
        async with self._cache_lock:
            return self._get_cached_no_lock(cache_key)

    def _get_cached_no_lock(self, cache_key: str) -> CachedNarrationAudio | None:
        entry = self._cache.get(cache_key)
        if entry is None:
            return None
        if (time.monotonic() - entry.created_at_monotonic) > self._cache_ttl_seconds:
            self._cache.pop(cache_key, None)
            return None
        self._cache.move_to_end(cache_key)
        return entry

    async def _store_cache_entry(self, entry: CachedNarrationAudio) -> None:
        async with self._cache_lock:
            self._cache[entry.cache_key] = entry
            self._cache.move_to_end(entry.cache_key)
            while len(self._cache) > self._cache_max_entries:
                self._cache.popitem(last=False)

    async def _finish_inflight(
        self,
        cache_key: str,
        *,
        entry: CachedNarrationAudio | None = None,
        error: Exception | None = None,
    ) -> None:
        async with self._cache_lock:
            inflight = self._inflight.pop(cache_key, None)
        if inflight is None:
            return
        inflight.entry = entry
        inflight.error = error
        inflight.event.set()

    async def _proxy_and_cache(
        self,
        *,
        cache_key: str,
        request: NarrationAudioRequest,
        provider_stream: ProviderAudioStream,
    ) -> AsyncIterator[bytes]:
        buffer = bytearray()
        started_at = time.monotonic()
        cache_entry: CachedNarrationAudio | None = None
        terminal_error: Exception | None = None
        try:
            async for chunk in provider_stream.stream:
                buffer.extend(chunk)
                yield chunk
            cache_entry = CachedNarrationAudio(
                cache_key=cache_key,
                content_type=provider_stream.content_type,
                audio_bytes=bytes(buffer),
                created_at_monotonic=time.monotonic(),
                request_id=provider_stream.request_id,
            )
            await self._store_cache_entry(cache_entry)
            log.info(
                "narration_audio_cached",
                experiment_id=request.experiment_id,
                round_number=request.round_number,
                narration_hash=cache_key,
                voice_id=request.voice_id,
                model_id=request.model_id,
                output_format=request.output_format,
                cache_hit=False,
                duration_seconds=round(time.monotonic() - started_at, 3),
                request_id=provider_stream.request_id,
            )
        except asyncio.CancelledError as exc:
            terminal_error = NarrationAudioError(
                "Narration audio stream was cancelled before completion.",
                status_code=502,
            )
            raise exc
        except Exception as exc:
            terminal_error = exc
            if isinstance(exc, NarrationAudioError):
                raise
            raise NarrationAudioError(
                "Narration audio generation failed.", status_code=502
            ) from exc
        finally:
            if cache_entry is not None:
                await self._finish_inflight(cache_key, entry=cache_entry)
            else:
                await self._finish_inflight(
                    cache_key,
                    error=terminal_error
                    or NarrationAudioError(
                        "Narration audio generation failed.",
                        status_code=502,
                    ),
                )

    async def _iter_bytes(
        self, audio_bytes: bytes, chunk_size: int = 16384
    ) -> AsyncIterator[bytes]:
        for offset in range(0, len(audio_bytes), chunk_size):
            yield audio_bytes[offset : offset + chunk_size]

    def _voice_settings(self) -> dict[str, float]:
        settings: dict[str, float] = {}
        if self._settings.elevenlabs_stability is not None:
            settings["stability"] = self._settings.elevenlabs_stability
        if self._settings.elevenlabs_similarity_boost is not None:
            settings["similarity_boost"] = self._settings.elevenlabs_similarity_boost
        if self._settings.elevenlabs_style is not None:
            settings["style"] = self._settings.elevenlabs_style
        if self._settings.elevenlabs_speed is not None:
            settings["speed"] = self._settings.elevenlabs_speed
        return settings
