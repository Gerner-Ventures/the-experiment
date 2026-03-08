---
title: "[P0] E2E game loop — connect frontend to backend API/WebSocket"
status: in_progress
issue: 45
priority: P0
tags: [stream-1, frontend, backend, integration]
---

# E2E Game Loop

Backend API is fully implemented (20 endpoints + WebSocket). Frontend has stores, composables, and views but not wired to real data. This ticket connects them.

## Backend Status

All endpoints exist: create, get, start, pause, step, agents, dossier, log, gm/plan, gm/approve, arc, inject, analytics/, runtime/llm-mode (GET/PUT)*, replay, rounds/snapshot, usage. WebSocket broadcasts 29 message types. Completion logic works (`experiment_end` on `current_round >= total_rounds`).

## Remaining Work

### 1. Wire SetupView to real API
- `SetupView.vue` currently stores config in sessionStorage
- Call `POST /api/experiments` with agent configs
- Redirect to `/simulation/{experiment_id}` on success

### 2. Wire SimulationView to real API
- Connect `useWebSocket` to `WS /api/experiments/{id}/ws`
- Call `POST /start` when simulation begins
- Wire ControlBar play/pause/step to real endpoints

### 3. Handle new WS message types
Backend sends types frontend doesn't handle: `connected`, `faction_update`, `cult_activity`, `exile_vote`, `exile_result`

### 4. Wire stores to API data
- Init stores from API responses, remove mock initial state
- `experimentStore` from GET detail, `agentStore` from GET agents, `worldStore` from world_state, `gmStore` from gm/plan

### 5. Completion flow
- `experiment_end` WS message > redirect to `/report/{id}`
- ReportView loads from analytics endpoints

### 6. Backend (minor): Contract alignment
- Verify WS payload shapes match frontend TypeScript types
- Ensure `gm_narration` is broadcast
- Standardize response shape mismatches

## Acceptance Criteria

- [x] Setup screen creates experiment via API and redirects
<!-- canon:realized-in:audit file:frontend/src/views/SetupView.vue:113-132 -->
- [x] Simulation connects to WebSocket with live updates
<!-- canon:realized-in:audit file:frontend/src/views/SimulationView.vue:28-42 -->
- [x] Play/pause/step controls call real endpoints
<!-- specwright:realized-in:PR#70 file:frontend/src/views/SimulationView.vue -->
- [ ] All stores populate from backend data (no mocks)
- [x] All WS message types handled (including faction, exile, cult)
<!-- canon:realized-in:audit file:frontend/src/composables/useWebSocket.ts:127-130 -->
- [ ] Game completes > experiment_end > redirect to report
- [ ] Full loop works with MockAgentBrain
- [ ] Error handling for API failures and WS disconnects
<!-- specwright:realized-in:PR#67 file:backend/app/agents/brain.py -->

## Key Files

**Frontend:** `SetupView.vue`, `SimulationView.vue`, `useWebSocket.ts`, `api.ts`, all stores
**Backend:** `runtime.py`, `routes/experiments.py`, `ws_message.py`
