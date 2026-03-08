# AGENTS.md

## Working Norms

- When assigned a new task, start from the local `main` branch unless the user explicitly asks you to continue from a different branch or worktree.
- Before doing any work, check whether the current checkout has uncommitted changes. If it does, ask the user how to proceed before making any edits.
- If the checkout is clean, update `main` from `origin/main` with a fast-forward-only pull before starting the task.
- If the task requires any file changes, create a new branch in a separate git worktree from the updated `main` branch and do the work there.
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

## Backend Dev Workflow Without Docker

If Docker is unavailable on the machine, use a two-lane backend workflow:

1. fast local iteration with no infrastructure
2. real persistence checks with Postgres only

Daily backend loop:

- Run backend work from `backend/` with local Python 3.12 and Poetry.
- Install dependencies with `poetry install`.
- For engine, GM, agent, and API contract changes, use the existing test suite first.
- Prefer targeted pytest runs during development, then run the full backend suite before handing off.
- For manual API testing, run `poetry run uvicorn app.main:app --reload` and exercise `/docs`.

Infra expectations:

- Most backend tests already use the in-memory store, so they do not require Docker, Postgres, or Redis.
- Redis is currently not in the backend critical path for normal day-to-day development.
- Real persistence validation still requires Postgres because the live runtime uses the SQLAlchemy store.
- If Postgres cannot be installed locally, use a hosted dev Postgres instance via `DATABASE_URL`.

When real Postgres is required:

- any change under `backend/app/api/store.py`
- any change under `backend/app/db/`
- Alembic migrations
- persistence, restart/recovery, or event-log durability behavior

Postgres verification loop:

- Set `DATABASE_URL` in `backend/.env` using the same format as `backend/.env.example`.
- Run `poetry run alembic upgrade head`.
- Run the backend locally with `poetry run uvicorn app.main:app --reload`.
- Do not consider persistence-related work done until it has been exercised against a real Postgres database.

## Change Expectations

- If you touch the round loop, game state, persistence, or websocket events, check `docs/GAME_RUNTIME.md`.
- If you change intended mechanics or player-facing rules, check `docs/GAME_DESIGN.md`.
- If you change endpoints or payloads, check `docs/API.md` and `shared/schemas/`.
- If you change deployment or local-dev workflow, check `docs/INFRASTRUCTURE.md`, `README.md`, and related plans.
