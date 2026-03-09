"""Tests for agent speech TTS endpoints, pregeneration, and WS messages (Tasks 2–4)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest

from app.api.models import CreateExperimentRequest
from app.api.runtime import ExperimentRuntime
from app.api.services import AgentSpeechEntry
from app.api.store import InMemoryExperimentStore
from app.core.config import Settings
from app.engine.models import PhaseResult, RoundEvent
from app.tts import NarrationAudioError, NarrationTTSService
from app.tts.models import NarrationAudioRequest, ProviderAudioStream


class _FakeProvider:
    def __init__(
        self,
        chunks: list[bytes] | None = None,
        error: Exception | None = None,
    ) -> None:
        self._chunks = chunks or [b"agent-audio"]
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


def _tts_service(provider: _FakeProvider | None = None) -> NarrationTTSService:
    return NarrationTTSService(
        Settings(
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-default",
            elevenlabs_model_id="model-test",
        ),
        provider=provider or _FakeProvider(),
    )


def _request() -> CreateExperimentRequest:
    return CreateExperimentRequest.model_validate(
        {
            "name": "Speech Test",
            "total_rounds": 4,
            "agents": [
                {
                    "name": "Mara",
                    "character_id": "undertaker_01",
                    "personality": {
                        "axes": {
                            "paranoia": 72,
                            "empathy": 40,
                            "dominance": 58,
                            "impulsiveness": 61,
                            "loyalty": 44,
                            "ambition": 70,
                        },
                        "trait_tags": ["guarded", "curious"],
                        "self_concept": "Asking the right questions.",
                    },
                    "goal": {
                        "archetype": "truth_revelation",
                        "text": "Find the truth.",
                        "progress_signals": ["observer clues"],
                    },
                },
                {
                    "name": "Jon",
                    "character_id": "caretaker_01",
                    "personality": {
                        "axes": {
                            "paranoia": 35,
                            "empathy": 62,
                            "dominance": 44,
                            "impulsiveness": 39,
                            "loyalty": 75,
                            "ambition": 48,
                        },
                        "trait_tags": ["dutiful", "protective"],
                        "self_concept": "Hold things together.",
                    },
                    "goal": {
                        "archetype": "communal_survival",
                        "text": "Keep the town functional.",
                        "progress_signals": ["resource stability"],
                    },
                },
            ],
        }
    )


# ---------- Task 2: build_speech_request / build_speech_audio_url ----------


def test_build_speech_request_uses_character_voice() -> None:
    service = _tts_service()
    req = service.build_speech_request(
        experiment_id="exp-1",
        round_number=1,
        text="I must warn the others.",
        character_id="undertaker_01",
    )
    assert req.voice_id == service.voice_id_for_character("undertaker_01")
    assert req.text == "I must warn the others."
    assert req.model_id == service.model_id
    assert req.output_format == service.output_format


def test_build_speech_request_falls_back_to_default_for_unknown() -> None:
    service = _tts_service()
    req = service.build_speech_request(
        experiment_id="exp-1",
        round_number=1,
        text="Hello.",
        character_id="unknown_char",
    )
    assert req.voice_id == "voice-default"


def test_build_speech_audio_url() -> None:
    service = _tts_service()
    url = service.build_speech_audio_url("exp-1", "agent-abc", 3, 1)
    assert url == "/api/experiments/exp-1/agents/agent-abc/speech/audio?round=3&index=1"


# ---------- Task 2: Agent speech metadata / stream ----------


@pytest.mark.asyncio
async def test_get_agent_speech_metadata_returns_pending_when_not_cached() -> None:
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(),
    )
    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    # Manually add a speech entry
    runtime._agent_speech_log[eid].append(
        AgentSpeechEntry(
            agent_id=agent.agent_id,
            character_id=agent.character_id or "",
            round_number=1,
            index=0,
            text="I must warn the others.",
        )
    )

    meta = await runtime.get_agent_speech_metadata(eid, agent.agent_id, 1, 0)
    assert meta.status == "pending"
    assert meta.text == "I must warn the others."
    assert meta.source == "dialogue"
    assert meta.agent_id == agent.agent_id
    assert meta.round_number == 1
    assert meta.index == 0
    # audio_url is only set when status is "ready"
    assert meta.audio_url is None


@pytest.mark.asyncio
async def test_get_agent_speech_metadata_404_for_missing_entry() -> None:
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(),
    )
    state = await runtime.create_experiment(_request())
    with pytest.raises(KeyError):
        await runtime.get_agent_speech_metadata(state.experiment_id, "no-such-agent", 1, 0)


@pytest.mark.asyncio
async def test_get_agent_speech_metadata_unavailable_without_tts() -> None:
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=None,
    )
    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    runtime._agent_speech_log[eid].append(
        AgentSpeechEntry(
            agent_id=agent.agent_id,
            character_id=agent.character_id or "",
            round_number=1,
            index=0,
            text="Something important.",
        )
    )

    meta = await runtime.get_agent_speech_metadata(eid, agent.agent_id, 1, 0)
    assert meta.status == "unavailable"
    assert meta.source == "dialogue"
    assert meta.audio_url is None


@pytest.mark.asyncio
async def test_get_agent_speech_audio_stream_returns_audio() -> None:
    provider = _FakeProvider()
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(provider),
    )
    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    runtime._agent_speech_log[eid].append(
        AgentSpeechEntry(
            agent_id=agent.agent_id,
            character_id=agent.character_id or "",
            round_number=1,
            index=0,
            text="Hello from the agent.",
        )
    )

    content_type, stream = await runtime.get_agent_speech_audio_stream(eid, agent.agent_id, 1, 0)
    audio_bytes = b"".join([chunk async for chunk in stream])
    assert content_type == "audio/mpeg"
    assert audio_bytes == b"agent-audio"
    assert provider.calls == 1


@pytest.mark.asyncio
async def test_get_agent_speech_audio_stream_404_for_missing() -> None:
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(),
    )
    state = await runtime.create_experiment(_request())
    with pytest.raises(KeyError):
        await runtime.get_agent_speech_audio_stream(state.experiment_id, "nonexistent", 1, 0)


@pytest.mark.asyncio
async def test_get_agent_speech_audio_stream_503_without_tts() -> None:
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=None,
    )
    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    runtime._agent_speech_log[eid].append(
        AgentSpeechEntry(
            agent_id=agent.agent_id,
            character_id=agent.character_id or "",
            round_number=1,
            index=0,
            text="Hello.",
        )
    )

    with pytest.raises(NarrationAudioError, match="not configured"):
        await runtime.get_agent_speech_audio_stream(eid, agent.agent_id, 1, 0)


# ---------- Task 3: Pregeneration ----------


@pytest.mark.asyncio
async def test_on_phase_complete_records_speech_entries_and_triggers_pregeneration() -> None:
    provider = _FakeProvider()
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(provider),
    )
    runtime.connection_manager.broadcast = AsyncMock()
    runtime.audio.broadcast_narration_audio_status_for_plan = AsyncMock()

    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    hook = runtime.streaming.build_hook(eid)
    phase_result = PhaseResult(
        phase="morning",
        events=[
            RoundEvent(
                phase="morning",
                summary="Mara speaks.",
                data={
                    "kind": "agent_speak",
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "target": "all",
                    "message": "We need to stick together!",
                    "source": "inner_thought",
                },
            ),
        ],
    )

    await hook.on_phase_complete(1, phase_result)

    # Speech entry should be recorded
    entries = runtime._agent_speech_log[eid]
    assert len(entries) == 1
    assert entries[0]["agent_id"] == agent.agent_id
    assert entries[0]["text"] == "We need to stick together!"
    assert entries[0]["source"] == "inner_thought"
    assert entries[0]["round_number"] == 1
    assert entries[0]["index"] == 0
    assert entries[0]["character_id"] == agent.character_id

    # Wait for background prewarm task
    await asyncio.sleep(0.1)

    # Check that agent_speech_audio WS messages were broadcast
    payloads = [call.args[1] for call in runtime.connection_manager.broadcast.await_args_list]
    speech_audio_msgs = [p for p in payloads if p.get("type") == "agent_speech_audio"]
    assert len(speech_audio_msgs) >= 1

    # Should have pending then ready
    statuses = [m["data"]["status"] for m in speech_audio_msgs]
    assert "pending" in statuses
    assert "ready" in statuses


@pytest.mark.asyncio
async def test_pregeneration_handles_multiple_agents_concurrently() -> None:
    provider = _FakeProvider()
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(provider),
    )
    runtime.connection_manager.broadcast = AsyncMock()
    runtime.audio.broadcast_narration_audio_status_for_plan = AsyncMock()

    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent1 = state.agents[0]
    agent2 = state.agents[1]

    hook = runtime.streaming.build_hook(eid)
    phase_result = PhaseResult(
        phase="morning",
        events=[
            RoundEvent(
                phase="morning",
                summary="Mara speaks.",
                data={
                    "kind": "agent_speak",
                    "agent_id": agent1.agent_id,
                    "agent_name": agent1.name,
                    "target": "all",
                    "message": "We must act!",
                },
            ),
            RoundEvent(
                phase="morning",
                summary="Jon speaks.",
                data={
                    "kind": "agent_speak",
                    "agent_id": agent2.agent_id,
                    "agent_name": agent2.name,
                    "target": "all",
                    "message": "Stay calm, everyone.",
                },
            ),
        ],
    )

    await hook.on_phase_complete(1, phase_result)
    await asyncio.sleep(0.1)

    # Both agents should have speech entries
    entries = runtime._agent_speech_log[eid]
    assert len(entries) == 2
    agent_ids = {e["agent_id"] for e in entries}
    assert agent1.agent_id in agent_ids
    assert agent2.agent_id in agent_ids

    # Provider should have been called for both
    assert provider.calls == 2


@pytest.mark.asyncio
async def test_pregeneration_failure_does_not_block_round() -> None:
    provider = _FakeProvider(error=NarrationAudioError("rate limited", status_code=503))
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(provider),
    )
    runtime.connection_manager.broadcast = AsyncMock()
    runtime.audio.broadcast_narration_audio_status_for_plan = AsyncMock()

    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    hook = runtime.streaming.build_hook(eid)
    phase_result = PhaseResult(
        phase="morning",
        events=[
            RoundEvent(
                phase="morning",
                summary="Mara speaks.",
                data={
                    "kind": "agent_speak",
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "target": "all",
                    "message": "Help!",
                },
            ),
        ],
    )

    # Should not raise even though TTS fails
    await hook.on_phase_complete(1, phase_result)
    await asyncio.sleep(0.1)

    # Error status should be broadcast
    payloads = [call.args[1] for call in runtime.connection_manager.broadcast.await_args_list]
    speech_audio_msgs = [p for p in payloads if p.get("type") == "agent_speech_audio"]
    assert any(m["data"]["status"] == "error" for m in speech_audio_msgs)


# ---------- Task 4: WS agent_speech_audio messages ----------


@pytest.mark.asyncio
async def test_unavailable_status_when_tts_not_configured() -> None:
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=None,
    )
    runtime.connection_manager.broadcast = AsyncMock()
    runtime.audio.broadcast_narration_audio_status_for_plan = AsyncMock()

    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    hook = runtime.streaming.build_hook(eid)
    phase_result = PhaseResult(
        phase="morning",
        events=[
            RoundEvent(
                phase="morning",
                summary="Mara speaks.",
                data={
                    "kind": "agent_speak",
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "target": "all",
                    "message": "Is anyone there?",
                },
            ),
        ],
    )

    await hook.on_phase_complete(1, phase_result)
    await asyncio.sleep(0.1)

    payloads = [call.args[1] for call in runtime.connection_manager.broadcast.await_args_list]
    speech_audio_msgs = [p for p in payloads if p.get("type") == "agent_speech_audio"]
    assert len(speech_audio_msgs) >= 1
    assert speech_audio_msgs[0]["data"]["status"] == "unavailable"
    assert speech_audio_msgs[0]["data"]["agent_id"] == agent.agent_id
    assert speech_audio_msgs[0]["data"]["round"] == 1
    assert speech_audio_msgs[0]["data"]["index"] == 0
    assert speech_audio_msgs[0]["data"]["audio_url"] is None


@pytest.mark.asyncio
async def test_agent_speech_audio_ws_message_includes_audio_url_on_ready() -> None:
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(),
    )
    runtime.connection_manager.broadcast = AsyncMock()
    runtime.audio.broadcast_narration_audio_status_for_plan = AsyncMock()

    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    hook = runtime.streaming.build_hook(eid)
    phase_result = PhaseResult(
        phase="morning",
        events=[
            RoundEvent(
                phase="morning",
                summary="Mara speaks.",
                data={
                    "kind": "agent_speak",
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "target": "all",
                    "message": "Let's move!",
                },
            ),
        ],
    )

    await hook.on_phase_complete(1, phase_result)
    await asyncio.sleep(0.1)

    payloads = [call.args[1] for call in runtime.connection_manager.broadcast.await_args_list]
    ready_msgs = [
        p
        for p in payloads
        if p.get("type") == "agent_speech_audio" and p.get("data", {}).get("status") == "ready"
    ]
    assert len(ready_msgs) == 1
    assert ready_msgs[0]["data"]["audio_url"] is not None
    assert agent.agent_id in ready_msgs[0]["data"]["audio_url"]


@pytest.mark.asyncio
async def test_multiple_utterances_per_round_get_distinct_indices() -> None:
    runtime = ExperimentRuntime(
        store=InMemoryExperimentStore(),
        tts_service=_tts_service(),
    )
    runtime.connection_manager.broadcast = AsyncMock()
    runtime.audio.broadcast_narration_audio_status_for_plan = AsyncMock()

    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    hook = runtime.streaming.build_hook(eid)

    # First phase with agent speaking
    phase1 = PhaseResult(
        phase="morning",
        events=[
            RoundEvent(
                phase="morning",
                summary="Mara speaks first time.",
                data={
                    "kind": "agent_speak",
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "target": "all",
                    "message": "First utterance.",
                },
            ),
        ],
    )
    await hook.on_phase_complete(1, phase1)

    # Second phase with same agent speaking again in same round
    phase2 = PhaseResult(
        phase="afternoon",
        events=[
            RoundEvent(
                phase="afternoon",
                summary="Mara speaks again.",
                data={
                    "kind": "agent_speak",
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "target": "all",
                    "message": "Second utterance.",
                },
            ),
        ],
    )
    await hook.on_phase_complete(1, phase2)

    entries = runtime._agent_speech_log[eid]
    agent_entries = [e for e in entries if e["agent_id"] == agent.agent_id]
    assert len(agent_entries) == 2
    assert agent_entries[0]["index"] == 0
    assert agent_entries[1]["index"] == 1
    assert agent_entries[0]["text"] == "First utterance."
    assert agent_entries[1]["text"] == "Second utterance."


# ---------- Reconstruction from persisted logs after restart ----------


@pytest.mark.asyncio
async def test_find_agent_speech_entry_reconstructs_from_persisted_logs() -> None:
    """After a process restart the in-memory speech log is empty.

    RuntimeAudioService._find_agent_speech_entry should fall back to the persisted event log
    and reconstruct the entry so /agents/{id}/speech* endpoints still work.
    """
    from app.api.models import EventLogItem

    store = InMemoryExperimentStore()
    runtime = ExperimentRuntime(store=store, tts_service=_tts_service())
    runtime.connection_manager.broadcast = AsyncMock()
    runtime.audio.broadcast_narration_audio_status_for_plan = AsyncMock()

    state = await runtime.create_experiment(_request())
    eid = state.experiment_id
    agent = state.agents[0]

    # Simulate persisted event log entries (as _log_round_result would create)
    await store.append_log(
        EventLogItem(
            id="evt-1",
            experiment_id=eid,
            round_number=1,
            phase="morning",
            type="morning",
            summary="Mara speaks.",
            data={
                "kind": "agent_speak",
                "agent_id": agent.agent_id,
                "agent_name": agent.name,
                "target": "all",
                "message": "First line.",
                "source": "inner_thought",
            },
            timestamp="2026-01-01T00:00:00Z",
        )
    )
    await store.append_log(
        EventLogItem(
            id="evt-2",
            experiment_id=eid,
            round_number=1,
            phase="morning",
            type="morning",
            summary="Mara speaks again.",
            data={
                "kind": "agent_speak",
                "agent_id": agent.agent_id,
                "agent_name": agent.name,
                "target": "all",
                "message": "Second line.",
                "source": "inner_thought",
            },
            timestamp="2026-01-01T00:01:00Z",
        )
    )

    # In-memory speech log is empty (simulates process restart)
    assert len(runtime._agent_speech_log.get(eid, [])) == 0

    # Should reconstruct from persisted logs
    entry = await runtime.audio._find_agent_speech_entry(eid, agent.agent_id, 1, 0)
    assert entry is not None
    assert entry["text"] == "First line."
    assert entry["source"] == "inner_thought"
    assert entry["agent_id"] == agent.agent_id
    assert entry["index"] == 0
    assert entry["character_id"] == agent.character_id

    # Second utterance
    entry2 = await runtime.audio._find_agent_speech_entry(eid, agent.agent_id, 1, 1)
    assert entry2 is not None
    assert entry2["text"] == "Second line."
    assert entry2["source"] == "inner_thought"
    assert entry2["index"] == 1

    # After reconstruction, entries should be cached in memory
    assert len(runtime._agent_speech_log[eid]) == 2

    # Non-existent index returns None
    entry_missing = await runtime.audio._find_agent_speech_entry(eid, agent.agent_id, 1, 5)
    assert entry_missing is None
