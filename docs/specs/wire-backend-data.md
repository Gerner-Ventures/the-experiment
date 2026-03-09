---
title: "[P0] Wire stores & HUD to real backend data (remove mocks)"
status: done
issue: 42
priority: P0
tags: [stream-1, frontend, backend, data-wiring]
---

# Wire Stores & HUD to Real Backend Data

Audit all components for hardcoded/mock data and wire to real backend API/WebSocket data.

## Audit Areas

**Stores** — 6 Pinia stores for mock initial state
- `experimentStore` — experiment config, round state, events
- `agentStore` — agent list, relationships, suspicion levels
- `worldStore` — map data, tile state
- `gmStore` — GM plans, crisis events
- `socialStore` — conversations, meetings
- `uiStore` — UI state (may keep defaults)

**HUD Components** — ThreatMeter, ResourceBars, RoundCounter, ArcTimeline

**API Service** — `api.ts` endpoint URLs and shapes

**WebSocket** — `useWebSocket.ts` message handlers for all 16 types

## Acceptance Criteria

- [x] Stores initialize from API data
<!-- specwright:realized-in:PR#69 file:frontend/src/stores/experiment.ts -->
- [x] HUD displays live store data
<!-- canon:realized-in: file:frontend/src/views/SimulationView.vue (ThreatMeter, ResourceBars, RoundCounter all receive props from stores) -->
- [x] API endpoints match backend routes
<!-- specwright:realized-in:PR#69 -->
- [x] WebSocket handles all message types
<!-- specwright:realized-in:PR#69 file:frontend/tests/unit/ws-routing.spec.ts -->
<!-- canon:realized-in: file:frontend/src/composables/wsRouter.ts (all 22 message types routed) -->
- [x] No placeholder data in production paths
<!-- canon:realized-in: file:frontend/src/views/SimulationView.vue (production paths load from API, no hardcoded mock data) -->
- [x] Demo mode still works as opt-in
<!-- canon:realized-in: file:frontend/src/views/SimulationView.vue route.params.id === 'demo' -->

## Key Files

Stores, HUD components, `api.ts`, `useWebSocket.ts`
