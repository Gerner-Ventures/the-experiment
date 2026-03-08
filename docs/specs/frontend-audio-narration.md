---
title: "[P1] Frontend audio narration playback — consume backend narration stream"
status: todo
issue: 102
priority: P1
tags: [stream-1, frontend, backend, narration, audio]
---

# Frontend Audio Narration Playback

Backend narration audio is now available in PR #101. The frontend needs to consume the new
narration metadata/audio endpoints and `gm_audio_status` websocket event so narration becomes
playable in the live simulation UI.

## Backend Status

Backend implementation complete (PR #101):

- `GET /api/experiments/{experiment_id}/rounds/{round_number}/narration` — narration metadata
- `GET /api/experiments/{experiment_id}/rounds/{round_number}/narration/audio` — audio stream
- websocket `gm_audio_status` — readiness events
- ElevenLabs TTS with in-memory caching
- Per-map voice selection scaffolding
- OS trust store for TLS
- Full test coverage in `test_tts_service.py`

Important contract note:

- the backend does not emit a dedicated `gm_narration` message in the active runtime path
- narration text should come from `gm_plan.plan.narration`
- audio readiness should come from `gm_audio_status` plus `GET /narration`

## Current Frontend Gap

The frontend narration UX is still based on older assumptions:

- `gmStore` expects `gm_narration`
- `NarrationOverlay.vue` is text-only
- websocket types do not include `gm_audio_status`
- the frontend API client has no narration metadata helper

## Required Work

### 1. Update contract types

Files:

- `frontend/src/types/websocket.ts`
- `frontend/src/types/gm.ts`
- `frontend/src/services/api.ts`

Changes:

- add `gm_audio_status` to `WSMessageType`
- stop treating `gm_narration` as the primary narration event
- add typed narration metadata support in the API client

### 2. Extend the API client

Add frontend helpers for:

- `getRoundNarration(experimentId, roundNumber)`
- normalized backend `audio_url` usage for playback

The frontend should play the backend URL directly. Do not add a frontend proxy layer.

### 3. Rework `gmStore`

Files:

- `frontend/src/stores/gm.ts`

Expected responsibilities:

- take narration text from `gm_plan.plan.narration`
- store narration round, text, audio URL, and audio error
- track narration audio state: `idle | pending | ready | unavailable | error`
- hydrate from `GET /rounds/{round}/narration` when needed
- react to websocket `gm_audio_status`
- coordinate playback state cleanly enough that the overlay does not spawn duplicate players

### 4. Route `gm_audio_status`

Files:

- `frontend/src/composables/useWebSocket.ts`

Changes:

- add `gm_audio_status` to routing
- keep `gm_plan`
- remove the assumption that live narration text arrives through `gm_narration`

### 5. Upgrade `NarrationOverlay.vue`

Files:

- `frontend/src/components/hud/NarrationOverlay.vue`
- `frontend/src/views/SimulationView.vue`

Requirements:

- preserve the current typewriter text behavior
- begin audio playback when narration is visible and audio is ready
- if audio is pending, keep showing text immediately
- if autoplay is blocked, expose a simple play or replay affordance
- if audio fails, keep the text overlay working
- dismissing narration should stop or pause active playback for that narration instance

### 6. Handle refresh and reconnect

The frontend must recover narration state even when it joins after the live websocket events were
already sent.

Expected behavior:

- if `experiment.gm_plan` exists and is applied, hydrate narration text from the plan
- call `GET /rounds/{round}/narration` for the current round to recover readiness and `audio_url`
- do not rely purely on live websocket delivery

## UX Requirements

- Text narration remains readable even if audio is unavailable.
- Audio is additive and must never block narration display.
- Browser autoplay restrictions should degrade gracefully.
- The UI should not produce overlapping duplicate playback for one narration instance.
- Users should be able to replay narration after dismissal or autoplay failure.

## Acceptance Criteria

- [ ] `gm_audio_status` is added to frontend websocket types and routed correctly
- [ ] the frontend no longer depends on `gm_narration` for live narration text
- [ ] `gm_plan.plan.narration` populates GM narration text
- [ ] `GET /rounds/{round}/narration` is wired into the API client
- [ ] the narration overlay can play audio from backend `audio_url`
- [ ] text narration still appears immediately while audio is pending
- [ ] autoplay-blocked browsers fall back to a manual play path
- [ ] audio failure does not break the narration overlay
- [ ] refresh or reconnect restores narration state from backend data
- [ ] frontend tests cover websocket routing and GM store narration-audio transitions

## Suggested Test Coverage

- websocket routing test for `gm_audio_status`
- GM store tests for `pending -> ready -> playing`, `pending -> error`, and hydration from REST
- component test for `NarrationOverlay` with ready, pending, blocked, and error states
- manual browser verification against backend PR #101

## Key Files

Frontend:

- `frontend/src/types/websocket.ts`
- `frontend/src/services/api.ts`
- `frontend/src/stores/gm.ts`
- `frontend/src/composables/useWebSocket.ts`
- `frontend/src/components/hud/NarrationOverlay.vue`
- `frontend/src/views/SimulationView.vue`

Backend references:

- `backend/app/api/routes/narration.py`
- `backend/app/api/runtime.py`
- `backend/app/tts/service.py`
- `docs/AUDIO_NARRATION.md`
