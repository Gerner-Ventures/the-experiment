---
title: "[P1] Agent voice narration — unique TTS voice per character sprite"
status: draft
priority: P1
tags: [stream-1, frontend, backend, audio, tts, agents]
---

# Agent Voice Narration

When an agent's speech bubble appears during the talking or thinking phase, the narrated line should be spoken aloud
using a voice unique to that character. Voice IDs are mapped per character sprite in backend config.

## Background

The backend already has ElevenLabs TTS infrastructure for GM narration (`NarrationTTSService`,
`ElevenLabsNarrationProvider`). Agent speech is currently text-only — the `agent_speak` WebSocket
event drives `ConversationBubble.vue` which displays dialogue as floating text bubbles.

This spec extends TTS to agent speech, reusing the existing provider and adding per-character voice
selection via `CHARACTER_VOICE_IDS` in `backend/app/core/config.py`.

Current backend behavior:

- action-turn narration uses the agent's `inner_thought`
- social conversation speech uses dialogue text
- `agent_speak` and speech metadata expose a `source` discriminator so frontend code can branch on
  `inner_thought` vs `dialogue`

## Design Constraints

- **Latency**: Agent dialogue is short (1-2 sentences). Use `eleven_turbo_v2` or fastest available
  model for sub-second generation.
- **Concurrency**: Multiple agents may speak per round. TTS requests should be pregenerated when
  the backend resolves agent decisions, not on-demand when the frontend requests audio.
- **Cost**: Cache aggressively. Same text + same voice = cache hit.
- **Pacing**: Audio playback should gate the thought/speech phase — don't advance to the next agent until
  their audio finishes (or a timeout fires).
- **Degradation**: If TTS is unavailable, the text bubble works exactly as today.

## 1. Backend: Agent Speech TTS

### 1.1 Voice resolution

Files: `backend/app/core/config.py`, `backend/app/tts/service.py`

- `CHARACTER_VOICE_IDS` maps character ID → ElevenLabs voice ID (already added).
- Add `voice_id_for_character(character_id: str) -> str` to `NarrationTTSService`.
- Falls back to `ELEVENLABS_VOICE_ID` if character ID is unmapped.

Acceptance criteria:

- [ ] `voice_id_for_character()` returns the correct voice ID for each of the 22 characters
- [ ] unmapped character IDs fall back to the default `ELEVENLABS_VOICE_ID`

### 1.2 Agent speech TTS endpoint

Files: `backend/app/api/routes/narration.py`, `backend/app/api/runtime.py`

Add REST endpoints for agent speech audio:

- `GET /api/experiments/{experiment_id}/agents/{agent_id}/speech` — metadata (text, source,
  voice_id, status, audio_url)
- `GET /api/experiments/{experiment_id}/agents/{agent_id}/speech/audio?round={n}&index={i}` —
  audio stream

The `round` + `index` params identify which utterance (an agent may speak multiple times per round).

Acceptance criteria:

- [ ] speech metadata endpoint returns agent speech text, source, resolved voice_id, and status
- [ ] speech audio endpoint streams MP3 audio for the requested utterance
- [ ] 404 when experiment, agent, or utterance index not found
- [ ] 409 when audio is not yet generated
- [ ] endpoints reuse existing error mapping (503 rate limit, 504 timeout, 502 upstream)

### 1.3 Pregenerate agent speech audio

Files: `backend/app/api/runtime.py`, `backend/app/tts/service.py`

When agent speech events are resolved for a round, the runtime should kick off TTS generation for
all of them in parallel (background tasks), before the frontend enters the thought/speech phase.
This includes both action-turn inner-thought narration and social conversation dialogue.

Acceptance criteria:

- [ ] agent speech audio is pregenerated when decisions are resolved for the round
<!-- canon:realized-in:PR#164 file:backend/app/engine/service.py -->
- [ ] pregeneration runs concurrently across agents (not sequential)
- [ ] pregeneration failures are logged but do not block the round
- [ ] generated audio is cached using the same LRU/TTL cache as GM narration

### 1.4 WebSocket: agent speech audio status

Files: `backend/app/api/runtime.py`, `shared/schemas/websocket.json`

Add `agent_speech_audio` WebSocket message:

```json
{
  "type": "agent_speech_audio",
  "payload": {
    "agent_id": "string",
    "round": 1,
    "index": 0,
    "source": "inner_thought | dialogue",
    "status": "pending | ready | error | unavailable",
    "audio_url": "/api/experiments/{id}/agents/{agent_id}/speech/audio?round=1&index=0"
  }
}
```

Emitted per-agent when speech audio becomes ready (or fails).

Acceptance criteria:

- [ ] `agent_speech_audio` message is emitted when audio generation completes or fails
- [ ] message includes agent_id, round, index, source, status, and audio_url
- [ ] `unavailable` status is sent when ElevenLabs is not configured

## 2. Frontend: Speech Audio Playback

### 2.1 WebSocket routing

Files: `frontend/src/composables/useWebSocket.ts`, `frontend/src/types/websocket.ts`

- Add `agent_speech_audio` to `WSMessageType`
- Route to `socialStore.onSpeechAudio()`

Acceptance criteria:

- [ ] `agent_speech_audio` message type is defined in websocket types
- [ ] messages are routed to the social store

### 2.2 Social store: audio state

Files: `frontend/src/stores/social.ts`

Track audio readiness per conversation entry:

- Add `audioStatus: 'idle' | 'pending' | 'ready' | 'error' | 'unavailable'` and `audioUrl` to
  conversation entries.
- `onSpeechAudio()` handler matches by agent_id + round + index, updates status and URL.

Acceptance criteria:

- [ ] conversation entries track audio status and URL
- [ ] `onSpeechAudio` updates the correct conversation entry

### 2.3 ConversationBubble: audio playback

Files: `frontend/src/components/social/ConversationBubble.vue`

When a bubble appears and audio is `ready`:

- Play audio via `new Audio(audioUrl).play()`
- Show a small speaker icon on the bubble during playback
- Handle autoplay blocking gracefully (show tap-to-play affordance)
- Use bubble variant styling to distinguish `inner_thought` from `dialogue`
- Emit `audioEnd` with the active `turnId` so stale dismissals cannot double-advance the queue
- On audio end or error, continue with normal bubble dismissal timing

Acceptance criteria:

- [ ] audio plays automatically when bubble appears and audio is ready
- [ ] speaker icon visible during playback
- [ ] autoplay-blocked browsers show manual play affordance
- [ ] audio failure does not break bubble display or dismissal
- [ ] bubble dismissal stops active audio playback

### 2.4 Turn pacing: audio-gated speech phase

Files: `frontend/src/stores/turn.ts`

The thinking/speech phase should wait for audio to finish before advancing to the next agent:

- If audio is `ready`, wait for playback completion (or a max timeout of 15s)
- If audio is `pending`, wait up to 3s for it to become ready, then proceed with text-only
- If audio is `unavailable` or `error`, use current text-only timing (6s auto-dismiss)

Acceptance criteria:

- [ ] thinking/speech phase waits for audio playback completion before advancing
- [ ] pending audio has a 3s wait timeout before falling back to text-only
- [ ] max audio timeout of 15s prevents indefinite blocking
- [ ] unavailable/error audio falls back to existing text-only timing

### 2.5 Audio controls

Files: `frontend/src/components/hud/` (new or existing)

- Global mute toggle for agent voices (persisted in localStorage)
- Volume control (optional, stretch goal)

Acceptance criteria:

- [ ] mute toggle for agent speech audio exists in the HUD
- [ ] mute state persists across page reloads via localStorage
- [ ] muted state skips audio playback but preserves text bubble behavior

## Key Files

Frontend:
- `frontend/src/types/websocket.ts`
- `frontend/src/stores/social.ts`
- `frontend/src/stores/turn.ts`
- `frontend/src/components/social/ConversationBubble.vue`
- `frontend/src/composables/useWebSocket.ts`

Backend:
- `backend/app/core/config.py` — `CHARACTER_VOICE_IDS`
- `backend/app/tts/service.py` — voice resolution, caching
- `backend/app/api/routes/narration.py` — speech endpoints
- `backend/app/api/runtime.py` — pregeneration, WS emission

Docs:
- `docs/AUDIO_NARRATION.md` — update with agent speech section
