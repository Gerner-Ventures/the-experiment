# Backend Guide

This document is the contributor-oriented map of the FastAPI backend: how it is structured, how to run it locally, which configuration matters, and where to make changes.

For the external API contract, see [docs/API.md](API.md).
For deployment and persistence details, see [docs/INFRASTRUCTURE.md](INFRASTRUCTURE.md).

## System Map

```mermaid
flowchart LR
    ROUTES["FastAPI routes"] --> RUNTIME["ExperimentRuntime"]
    RUNTIME --> STORE["ExperimentStore"]
    STORE --> SQL["SqlAlchemyExperimentStore"]
    SQL --> DB[(Postgres)]
    RUNTIME --> ENGINE["SimulationEngine"]
    ENGINE --> GM["GMService"]
    ENGINE --> AGENTS["AgentService"]
    ENGINE --> SOCIAL["SocialService"]
    ENGINE --> WORLD["World services"]
    RUNTIME --> WS["ConnectionManager"]
    GM --> LLM["LiteLLM-backed providers"]
    AGENTS --> LLM
```

## Code Layout

| Path | Responsibility |
|------|----------------|
| `backend/app/main.py` | FastAPI app wiring, middleware, OpenAPI setup |
| `backend/app/api/routes/` | REST and WebSocket route definitions |
| `backend/app/api/runtime.py` | High-level experiment orchestration, persistence boundary, broadcast fanout, analytics/replay assembly |
| `backend/app/api/store.py` | Store interface plus in-memory and SQLAlchemy-backed implementations |
| `backend/app/engine/` | Core simulation loop and round-phase execution |
| `backend/app/gm/` | Director arc models, preset arcs, GM planning/generation |
| `backend/app/agents/` | Agent prompts, decisions, memory handling, relationship state |
| `backend/app/social/` | Meetings, conversations, relationship deltas |
| `backend/app/world/` | World map, locations, resources, threat model |
| `backend/app/db/` | SQLAlchemy models and async session setup |
| `backend/app/llm/` | Provider selection, usage tracking, prompt traces |
| `backend/alembic/` | Schema migrations |
| `backend/tests/` | API, engine, GM, social, and integration-style tests |

## Request Flow

The main control path for one round is:

1. The client calls `POST /api/experiments/{id}/step`.
2. `ExperimentRuntime` loads the current `SimulationState` from the store.
3. A GM plan is loaded or generated for the upcoming round.
4. `SimulationEngine` runs the round phases and mutates the in-memory state object.
5. The updated state, round snapshot, and event log entries are persisted.
6. The runtime broadcasts WebSocket updates for the completed round.
7. The API returns `StepResponse` with both the round output and refreshed experiment snapshot.

Operationally important details:

- The default runtime store is `SqlAlchemyExperimentStore`, not the in-memory store.
- The in-memory store is used mainly in tests.
- WebSocket connections are process-local and are not restored after a backend restart.
- Redis is provisioned but is not yet the real-time fanout mechanism.

## Local Development

### First-time setup

```bash
make setup
make env
```

Then edit `backend/.env`:

- keep `DATABASE_URL` pointed at your local Postgres unless you intentionally want a remote database
- add whichever LLM provider keys you plan to use

### Start the stack

```bash
make dev-detached
make migrate
```

Useful commands:

- `make logs-backend`
- `make restart-backend`
- `make test-backend`
- `make lint-backend`
- `make db-shell`
- `make db-reset`

Notes:

- `docker compose up` does not run Alembic automatically in local dev, so `make migrate` is required before creating experiments.
- `GET /api/health` is the only built-in health endpoint today.
- If the backend restarts, experiment state should survive, but active WebSocket subscribers will need to reconnect.

## Configuration Reference

The backend settings are defined in `backend/app/core/config.py` and sample values live in `backend/.env.example`.

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `DATABASE_URL` | `postgresql+asyncpg://experiment:experiment@localhost:5432/experiment` | Yes | Durable experiment state, logs, GM plans, snapshots |
| `REDIS_URL` | `redis://localhost:6379/0` | No | Reserved for future ephemeral coordination and fanout |
| `ENV` | `development` | No | Environment label |
| `LOG_LEVEL` | `debug` | No | Logging verbosity |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | No | Allowed browser origins |
| `PLATFORM_URL` | unset | No | Production URL; used to derive CORS when explicit origins are not set |
| `ANTHROPIC_API_KEY` | unset | Depends | Needed if any configured model uses Anthropic |
| `OPENAI_API_KEY` | unset | Depends | Needed if any configured model uses OpenAI |
| `GOOGLE_API_KEY` | unset | Depends | Needed if any configured model uses Google |
| `GM_MODEL` | `anthropic/claude-3-5-sonnet-20241022` | No | Primary model for GM planning |
| `GM_FALLBACK_MODEL` | `openai/gpt-4o-mini` | No | Fallback GM model |
| `AGENT_MODEL` | `openai/gpt-4o-mini` | No | Primary model for agent decisions |
| `AGENT_FALLBACK_MODEL` | `anthropic/claude-3-5-haiku-20241022` | No | Fallback agent model |
| `MEMORY_MODEL` | `openai/gpt-4o-mini` | No | Model used for memory consolidation |
| `LLM_TIMEOUT_SECONDS` | `45` | No | Per-request timeout for LLM calls |
| `LLM_MAX_RETRIES` | `2` | No | Retries before falling back |
| `LLM_MAX_FALLBACKS` | `2` | No | Number of fallback attempts |
| `LLM_DEFAULT_TEMPERATURE` | `0.8` | No | Default generation temperature |

Provider guidance:

- You do not need every provider key, only the keys required by the model aliases you configured.
- If you change model families, make sure the matching API key is present.

## Persistence And Runtime Boundaries

Persisted today:

- experiment metadata and world state
- agent state, memory, relationships, faction assignment, and influence
- unresolved plotlines and recent-event summaries
- GM plans and their approval/application status
- event log entries
- per-round world snapshots
- LLM usage records and prompt traces

Still in-memory today:

- active WebSocket connection handles
- per-process broadcast fanout

This means a backend restart should preserve experiment state, but not live subscriptions.

## Backend Behavior Worth Knowing

- `step` moves `setup` experiments to `running` automatically.
- `step` does not currently require prior manual GM approval. If you need to override the next GM plan, call `GET /gm/plan` and `POST /gm/approve` before stepping.
- The WebSocket endpoint is outbound-only. Use REST for control actions like stepping, pausing, injecting events, or approving plans.
- Analytics, replay, and usage endpoints are assembled from persisted state and logs rather than from a separate reporting system.

## Where To Change What

- New REST endpoint: `backend/app/api/routes/experiments.py` plus `backend/app/api/models.py`
- Change experiment lifecycle logic: `backend/app/api/runtime.py`
- Change round mechanics: `backend/app/engine/service.py`
- Change GM planning or preset arcs: `backend/app/gm/`
- Change agent prompting, memory, or relationship behavior: `backend/app/agents/`
- Change persistence shape: `backend/app/api/store.py`, `backend/app/db/models.py`, and Alembic migrations
- Change analytics/replay output: `backend/app/api/runtime.py`
- Change provider behavior or usage reporting: `backend/app/llm/`

## Verification

The fastest backend-focused validation loop is:

```bash
cd backend
poetry run pytest tests/test_api_docs.py tests/test_api_layer.py
```

For full local parity checks, use `make check` from the repo root.
