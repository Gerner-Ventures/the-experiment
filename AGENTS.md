# AGENTS.md

## Working Norms

- Prefer creating a new git worktree for feature work instead of reusing a dirty checkout.
- Use one branch per worktree so feature changes stay isolated and reviewable.
- Keep PRs focused. If the repo already has unrelated local changes, do not mix them into your branch.
- Update relevant docs in the same PR as behavior, API, or workflow changes.

## Docs Map

Start with `README.md` for project setup and high-level context.

Relevant docs under `docs/`:

- `docs/GAME_DESIGN.md`: design intent, mechanics, player experience, intended round structure
- `docs/GAME_RUNTIME.md`: implemented game state, round execution, persistence, websocket flow
- `docs/API.md`: API endpoints and contracts
- `docs/ARCHITECTURE.md`: frontend architecture and state-management decisions
- `docs/INFRASTRUCTURE.md`: deployment and environment topology
- `docs/WORKSTREAMS.md`: project breakdown by stream
- `docs/specs/`: feature-specific specs
- `docs/plans/`: implementation/design plans for discrete tasks

When a PR changes runtime behavior, API contracts, or developer workflow, update the matching doc or add one.

## Backend App Structure

The backend application lives under `backend/app/`.

Primary directories:

- `backend/app/api/`: FastAPI runtime layer, routes, websocket broadcast flow, persistence integration
- `backend/app/engine/`: simulation state models and round execution
- `backend/app/gm/`: GM planning, presets, and plan models
- `backend/app/agents/`: agent context, memory, decision handling, registry, mock brain
- `backend/app/social/`: conversations, meetings, votes, and relationship effects
- `backend/app/world/`: world map data, world state, resource and threat calculations
- `backend/app/llm/`: LLM client and usage tracking
- `backend/app/db/`: SQLAlchemy models, sessions, and persistence plumbing
- `backend/app/schemas/`: API-facing schema definitions
- `backend/app/core/`: configuration and core app wiring

Useful backend entry points:

- `backend/app/main.py`: application bootstrap
- `backend/app/api/runtime.py`: main experiment runtime path and websocket broadcasting
- `backend/app/engine/service.py`: implemented round loop
- `backend/app/engine/models.py`: canonical simulation state models
- `backend/app/api/store.py`: save/load logic for runtime state
- `backend/app/db/models.py`: database schema

## Change Expectations

- If you touch the round loop, game state, persistence, or websocket events, check `docs/GAME_RUNTIME.md`.
- If you change intended mechanics or player-facing rules, check `docs/GAME_DESIGN.md`.
- If you change endpoints or payloads, check `docs/API.md` and `shared/schemas/`.
- If you change deployment or local-dev workflow, check `docs/INFRASTRUCTURE.md`, `README.md`, and related plans.
