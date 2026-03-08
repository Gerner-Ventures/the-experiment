from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from types import SimpleNamespace

import pytest

from app.core import config as config_module
from app.core.config import Settings
from app.tts import ElevenLabsNarrationProvider, NarrationAudioError, NarrationTTSService
from app.tts.models import NarrationAudioRequest, ProviderAudioStream


class _FakeNarrationProvider:
    def __init__(self, chunks: list[bytes] | None = None, error: Exception | None = None) -> None:
        self._chunks = chunks or [b"hello ", b"world"]
        self._error = error
        self.calls = 0

    async def start_stream(self, request: NarrationAudioRequest) -> ProviderAudioStream:
        self.calls += 1
        if self._error is not None:
            raise self._error

        async def iterate() -> AsyncIterator[bytes]:
            for chunk in self._chunks:
                yield chunk

        return ProviderAudioStream(
            content_type="audio/mpeg",
            request_id=f"req-{request.round_number}",
            stream=iterate(),
        )

    async def aclose(self) -> None:
        return None


class _CancelableNarrationProvider:
    def __init__(self) -> None:
        self.calls = 0
        self.first_chunk_sent = asyncio.Event()

    async def start_stream(self, request: NarrationAudioRequest) -> ProviderAudioStream:
        self.calls += 1
        if self.calls == 1:

            async def iterate() -> AsyncIterator[bytes]:
                self.first_chunk_sent.set()
                yield b"partial"
                await asyncio.sleep(60)

            return ProviderAudioStream(
                content_type="audio/mpeg",
                request_id="req-cancel",
                stream=iterate(),
            )

        async def iterate() -> AsyncIterator[bytes]:
            yield b"recovered"

        return ProviderAudioStream(
            content_type="audio/mpeg",
            request_id="req-retry",
            stream=iterate(),
        )

    async def aclose(self) -> None:
        return None


@pytest.mark.asyncio
async def test_cache_key_is_stable_for_identical_requests() -> None:
    service = NarrationTTSService(
        Settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-test",
            elevenlabs_model_id="model-test",
        ),
        provider=_FakeNarrationProvider(),
    )
    first = service.build_request(experiment_id="exp-1", round_number=1, text="Hello town.")
    second = service.build_request(experiment_id="exp-1", round_number=1, text="Hello town.")

    assert service.cache_key(first) == service.cache_key(second)


@pytest.mark.asyncio
async def test_stream_caches_audio_and_reuses_cache_on_second_request() -> None:
    provider = _FakeNarrationProvider()
    service = NarrationTTSService(
        Settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-test",
            elevenlabs_model_id="model-test",
        ),
        provider=provider,
    )
    request = service.build_request(experiment_id="exp-1", round_number=1, text="Hello town.")

    first = await service.stream(request)
    first_bytes = b"".join([chunk async for chunk in first.stream])
    second = await service.stream(request)
    second_bytes = b"".join([chunk async for chunk in second.stream])

    assert first.cache_hit is False
    assert second.cache_hit is True
    assert first_bytes == b"hello world"
    assert second_bytes == b"hello world"
    assert provider.calls == 1


@pytest.mark.asyncio
async def test_prewarm_populates_cache_before_audio_request() -> None:
    provider = _FakeNarrationProvider()
    service = NarrationTTSService(
        Settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-test",
            elevenlabs_model_id="model-test",
        ),
        provider=provider,
    )
    request = service.build_request(experiment_id="exp-1", round_number=1, text="Hello town.")

    await service.prewarm(request)
    status, cache_hit = await service.get_status(request)

    assert status == "ready"
    assert cache_hit is True
    assert provider.calls == 1


@pytest.mark.asyncio
async def test_stream_surfaces_provider_errors() -> None:
    service = NarrationTTSService(
        Settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-test",
            elevenlabs_model_id="model-test",
        ),
        provider=_FakeNarrationProvider(
            error=NarrationAudioError("provider failed", status_code=502)
        ),
    )
    request = service.build_request(experiment_id="exp-1", round_number=1, text="Hello town.")

    with pytest.raises(NarrationAudioError, match="provider failed"):
        await service.stream(request)


@pytest.mark.asyncio
async def test_cancelled_stream_clears_inflight_and_allows_retry() -> None:
    provider = _CancelableNarrationProvider()
    service = NarrationTTSService(
        Settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-test",
            elevenlabs_model_id="model-test",
        ),
        provider=provider,
    )
    request = service.build_request(experiment_id="exp-1", round_number=1, text="Hello town.")
    first = await service.stream(request)

    async def consume() -> bytes:
        chunks = bytearray()
        async for chunk in first.stream:
            chunks.extend(chunk)
        return bytes(chunks)

    task = asyncio.create_task(consume())
    await provider.first_chunk_sent.wait()
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    retry = await asyncio.wait_for(service.stream(request), timeout=0.5)
    retry_bytes = b"".join([chunk async for chunk in retry.stream])

    assert retry_bytes == b"recovered"
    assert provider.calls == 2


@pytest.mark.asyncio
async def test_elevenlabs_provider_closes_owned_httpx_client() -> None:
    provider = ElevenLabsNarrationProvider(
        api_key="test-key",
        timeout_seconds=1,
    )

    assert provider._owned_httpx_client is not None
    assert provider._owned_httpx_client.is_closed is False

    await provider.aclose()

    assert provider._owned_httpx_client is None


def test_elevenlabs_provider_uses_system_trust_store_for_owned_httpx_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    sentinel_context = object()

    class _DummyAsyncClient:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)
            self.is_closed = False

        async def aclose(self) -> None:
            self.is_closed = True

    monkeypatch.setattr(
        "app.tts.elevenlabs.truststore.SSLContext",
        lambda protocol: sentinel_context,
    )
    monkeypatch.setattr("app.tts.elevenlabs.httpx.AsyncClient", _DummyAsyncClient)
    monkeypatch.setattr(
        "app.tts.elevenlabs.AsyncElevenLabs",
        lambda **kwargs: SimpleNamespace(**kwargs),
    )

    provider = ElevenLabsNarrationProvider(
        api_key="test-key",
        timeout_seconds=3,
    )

    assert captured["timeout"] == 3
    assert captured["verify"] is sentinel_context
    assert provider._owned_httpx_client is not None


def test_voice_id_for_character_returns_mapped_voice_for_all_characters() -> None:
    service = NarrationTTSService(
        Settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-default",
            elevenlabs_model_id="model-test",
        ),
        provider=_FakeNarrationProvider(),
    )

    for character_id, expected_voice_id in config_module.CHARACTER_VOICE_IDS.items():
        assert service.voice_id_for_character(character_id) == expected_voice_id

    assert len(config_module.CHARACTER_VOICE_IDS) == 22


def test_voice_id_for_character_falls_back_to_default_for_unmapped() -> None:
    service = NarrationTTSService(
        Settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-default",
            elevenlabs_model_id="model-test",
        ),
        provider=_FakeNarrationProvider(),
    )

    assert service.voice_id_for_character("unknown-character") == "voice-default"
    assert service.voice_id_for_character("") == "voice-default"


def test_voice_id_for_map_prefers_override_and_falls_back_to_default() -> None:
    original = dict(config_module.MAP_NARRATOR_VOICE_IDS)
    config_module.MAP_NARRATOR_VOICE_IDS.clear()
    config_module.MAP_NARRATOR_VOICE_IDS.update({"Default Town": "voice-town"})
    try:
        service = NarrationTTSService(
            Settings(
                elevenlabs_api_key="test-key",
                elevenlabs_voice_id="voice-default",
                elevenlabs_model_id="model-test",
            ),
            provider=_FakeNarrationProvider(),
        )

        assert service.voice_id_for_map("Default Town") == "voice-town"
        assert service.voice_id_for_map("Unknown Map") == "voice-default"
        assert service.voice_id_for_map(None) == "voice-default"
    finally:
        config_module.MAP_NARRATOR_VOICE_IDS.clear()
        config_module.MAP_NARRATOR_VOICE_IDS.update(original)
