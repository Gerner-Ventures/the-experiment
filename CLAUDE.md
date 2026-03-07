# the-experiment

AI agent simulation game — Lord of the Flies meets The Truman Show.

## Project Structure

```
the-experiment/
├── frontend/          Vue 3 + PixiJS + Ant Design + Tailwind
├── backend/           Python FastAPI (not active yet)
├── k8s/               Kubernetes manifests
├── shared/schemas/    JSON Schema API contracts (source of truth)
├── docs/              Architecture decisions, game design, work streams
└── .claude/skills/    Claude skills for this project
```

## Active Work

Stream 1 (Frontend) is the active work stream. See `docs/WORKSTREAMS.md`.

## Key Docs
- `docs/ARCHITECTURE.md` — Frontend architecture decisions (state, PixiJS, WebSocket, components, animation)
- `docs/GAME_DESIGN.md` — Full game loop, GM system, agent schemas
- `docs/WORKSTREAMS.md` — All tickets across 3 streams
- `frontend/CLAUDE.md` — Frontend-specific conventions and rules

## Testing
- Jest: `cd frontend && npm test`
- Playwright: `cd frontend && npm run test:e2e`
- Type check: `cd frontend && npm run type-check`

## currentDate
Today's date is 2026-03-06.
