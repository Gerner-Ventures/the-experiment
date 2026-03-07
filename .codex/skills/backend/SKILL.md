---
name: backend
description: Backend engineer mode for this repository. Use when the user starts the prompt with `$backend` or explicitly wants backend-scoped work in `backend/` only. Focus on FastAPI, engine, GM, agents, persistence, schemas, migrations, backend tests, and backend docs. Keep work rooted in `backend/` unless a backend change requires a paired frontend or infrastructure follow-up.
---

# Backend

Operate as the backend engineer for this repository.

## Scope

- Treat `backend/` as the primary workspace and default cwd for implementation, tests, and review.
- Limit code changes to backend-owned paths unless the task explicitly asks for broader changes.
- Read `README.md` and `docs/BACKEND.md` first when you need repo or runtime context.
- Use backend-focused docs as the source of truth:
  - `docs/GAME_RUNTIME.md` for runtime, round loop, persistence, and websocket behavior
  - `docs/API.md` and `shared/schemas/` for API contracts
  - `docs/GAME_DESIGN.md` for mechanics or player-facing rule changes
  - `docs/INFRASTRUCTURE.md` for backend deployment or local workflow changes

## Working Rules

- Prefer creating a new git worktree for feature work instead of reusing a dirty checkout.
- Create backend branches with a backend-prefixed name that still respects the global branch convention: `phil/backend-<topic>`.
- Keep PRs backend-focused. Do not pull frontend or infra implementation into the same branch unless the user explicitly asks for cross-stack work.
- Update the matching docs in the same change when backend behavior, API contracts, persistence, or developer workflow changes.

## Execution

- Run backend commands from `backend/` unless a root-level command is clearly better.
- Use Poetry for backend workflows: `poetry install`, `poetry run pytest`, `poetry run uvicorn app.main:app --reload`.
- Prefer targeted pytest runs during iteration, then run the relevant broader backend suite before handing off.
- For persistence changes under `backend/app/api/store.py`, `backend/app/db/`, or Alembic, verify against real Postgres before considering the work done.

## Cross-Stream Handoffs

- If backend work requires corresponding frontend or infrastructure changes, do not silently absorb that work into the branch.
- Create follow-up issues for the other workstreams when tooling allows it.
- Tag frontend follow-ups for Stream 1 and infrastructure follow-ups for Stream 3 using the repo's available labels.
- Reference those issue IDs in the PR description and call out the dependency or follow-up explicitly.
- If issue creation tooling is unavailable, draft the issue title and body in your final handoff and state that creation still needs to happen.
