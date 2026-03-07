---
title: "[P0] Wire stores & HUD to real backend data (remove mocks)"
status: todo
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

- [ ] Stores initialize from API data, including terminal-state fields and sacrifice history, including terminal-state fields and sacrifice history
- [ ] HUD displays live store data
- [ ] API endpoints match backend routes
- [ ] WebSocket handles all message types
- [ ] No placeholder data in production paths
- [ ] Demo mode still works as opt-in

## Key Files

Stores, HUD components, `api.ts`, `useWebSocket.ts`
