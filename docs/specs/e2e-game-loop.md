---
title: "[P0] E2E game loop — connect frontend to backend API/WebSocket"
status: todo
issue: 45
priority: P0
tags: [stream-1, frontend, backend, integration]
---

# E2E Game Loop

Bridge frontend and backend for a fully playable simulation.

## Backend API Endpoints Needed

- `POST /api/experiments` — create experiment
- `GET /api/experiments/:id` — get state
- `POST /api/experiments/:id/start` — begin simulation
- `POST /api/experiments/:id/pause` — pause
- `POST /api/experiments/:id/step` — advance one round
- `GET /api/experiments/:id/agents` — list agents
- `GET /api/experiments/:id/events` — event log
- WebSocket handler broadcasting phase/event messages

## Frontend Wiring

- Connect stores to real API endpoints
- WebSocket handler for all 16 message types
- Setup > create experiment > simulation > report flow
- Game completion triggers report view

## Acceptance Criteria

- [ ] Create experiment from setup screen
- [ ] Simulation runs all 6 phases per round
- [ ] Real-time state updates via WebSocket
- [ ] LLM-driven or mock agent decisions (including terminal actions like self-sacrifice)
- [ ] Resources deplete, threat changes, crises occur
- [ ] Game completes after configured rounds
- [ ] Report shows actual data
- [ ] Works with `MockAgentBrain` for testing

## Key Files

Cross-cutting (frontend stores, backend API, WebSocket)
