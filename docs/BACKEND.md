# Backend Guide

This document is the contributor-oriented map of the FastAPI backend: how it is structured, how to run it locally, which configuration matters, and where to make changes.

For the external API contract, see [docs/API.md](API.md).
For narration audio architecture and local verification, see [docs/AUDIO_NARRATION.md](AUDIO_NARRATION.md).
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
    AGENTS --> LLM["LiteLLM-backed providers"]
```

## Code Layout

| Path | Responsibility |
|------|----------------|
| `backend/app/main.py` | FastAPI app wiring, middleware, OpenAPI setup |
| `backend/app/core/runtime_factory.py` | Runtime/store construction for default and smoke modes |
| `backend/app/api/routes/` | REST and WebSocket route definitions |
| `backend/app/api/runtime.py` | High-level experiment orchestration, persistence boundary, broadcast fanout, analytics/replay assembly |
| `backend/app/api/store.py` | Store interface plus in-memory and SQLAlchemy-backed implementations |
| `backend/app/e2e/` | Real-server smoke client and checked-in smoke scenario payload |
| `backend/app/engine/` | Core simulation loop and round-phase execution |
| `backend/app/gm/` | Director arc models, preset arcs, GM planning/generation |
| `backend/app/agents/` | Agent prompts, decisions, observation recording, memory consolidation, relationship state |
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
- `backend/app/main.py` now builds the FastAPI app through `create_app(...)` and attaches the
  selected `ExperimentRuntime` to `app.state.runtime`.
- Routes resolve the runtime from `app.state` instead of importing a module-global singleton.
- WebSocket connections are process-local and are not restored after a backend restart.
- Redis is provisioned but is not yet the real-time fanout mechanism.

## Local Development

### First-time setup

```bash
make setup
make env
```

Then edit `backend/.env`:

- keep `DATABASE_URL` aligned with the backend runtime you are launching outside Doppler;
  `make migrate` itself uses the Neon branch wired through Doppler `dev`
- add whichever LLM provider keys you plan to use

### Start the stack

```bash
make dev-detached
make migrate
```

If you need to bypass Neon and use the local `DATABASE_URL` from `backend/.env`, run:

```bash
make local-migrate
```

Useful commands:

- `make logs-backend`
- `make restart-backend`
- `make test-backend`
- `make lint-backend`
- `make db-shell`
- `make backend-run`
- `make backend-e2e`

Notes:

- `docker compose up` does not run Alembic automatically in local dev, so `make migrate` is required before creating experiments.
- `make migrate` provisions or reuses the Neon branch for the current git branch, updates Doppler
  `dev` `DATABASE_URL`, and then runs Alembic against that branch.
- `GET /api/health` is the only built-in health endpoint today.
- If the backend restarts, experiment state should survive, but active WebSocket subscribers will need to reconnect.

### Headless Simulation Runner

If you want to inspect round-by-round backend behavior without FastAPI, Postgres, Redis, or
websockets, run the headless runner from `backend/`:

```bash
make headless HEADLESS_ROUNDS=3 HEADLESS_SEED=11 HEADLESS_JSON_OUT=/tmp/headless-report.json
```

Behavior:

- default mode is `mock`
- `make help` lists both `headless` and `headless-live`
- `mock` mode uses `ExperimentRuntime` with the in-memory store, a rule-based GM, seeded mock
  agents, and disabled memory-LLM consolidation
- `live` mode uses the LLM-backed GM and agent services against the same in-memory runtime path;
  use it only when the provider API keys are available in your shell environment
- the command always prints a readable terminal summary and can also write a structured JSON report

This is the fastest way to sanity-check that the backend round loop, derived analytics, and
persisted event logs match your mental model before you involve the HTTP API or real persistence.

### Neon-Backed Backend E2E Smoke

Use this workflow when you need the real FastAPI runtime path that the frontend talks to:

```bash
make migrate
BACKEND_RUNTIME_MODE=smoke_mock make backend-run
make backend-e2e
```

What it covers:

- real `uvicorn` startup
- real HTTP requests against the running backend
- real websocket delivery from `/api/experiments/{id}/ws`
- real `SqlAlchemyExperimentStore` persistence through Postgres
- GM plan fetch and approval
- one full round step plus log, analytics, replay, and snapshot reads

Runtime modes:

- `default`: Postgres-backed runtime with the existing GM and agent wiring
- `smoke_mock`: Postgres-backed runtime with rule-based GM planning, seeded mock agents, and no
  provider-key requirement
- `smoke_live`: Postgres-backed runtime with the live LLM-backed services

Command notes:

- `make backend-run` starts `poetry run uvicorn app.main:app --reload`
- set `BACKEND_RUNTIME_MODE=smoke_mock` for the repeatable local smoke path
- `make backend-e2e` runs `python -m app.e2e.smoke` against `http://127.0.0.1:8000` by default
- override `BACKEND_HOST`, `BACKEND_PORT`, or `BACKEND_BASE_URL` when needed
- `make migrate` prepares the Neon branch for the current git branch and applies migrations before
  the smoke client runs

Use `headless` when you only need a fast mechanics harness. Use `backend-e2e` when you need to
validate app wiring, route/schema integration, persistence, or websocket fanout end to end.

## Configuration Reference

The backend settings are defined in `backend/app/core/config.py` and sample values live in `backend/.env.example`.

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `DATABASE_URL` | `postgresql+asyncpg://experiment:experiment@localhost:5432/experiment` | Yes | Durable experiment state, logs, GM plans, snapshots; `make migrate` overrides this via Doppler `dev` for Neon-backed migrations |
| `BACKEND_RUNTIME_MODE` | `default` | No | Runtime wiring mode: `default`, `smoke_mock`, or `smoke_live` |
| `SMOKE_SEED` | `11` | No | Seed used for deterministic mock smoke runs |
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
| `MEMORY_MODEL` | `openai/gpt-4o-mini` | No | Primary model used for memory workflows |
| `MEMORY_FALLBACK_MODEL` | `anthropic/claude-3-5-haiku-20241022` | No | Fallback model for memory workflows |
| `LLM_TIMEOUT_SECONDS` | `45` | No | Per-request timeout for LLM calls |
| `LLM_MAX_RETRIES` | `2` | No | Retries before falling back |
| `LLM_MAX_FALLBACKS` | `2` | No | Number of fallback attempts |
| `LLM_DEFAULT_TEMPERATURE` | `0.8` | No | Default generation temperature |
| `ELEVENLABS_API_KEY` | unset | No | Enables backend-generated narration audio |
| `ELEVENLABS_VOICE_ID` | unset | No | Default narration voice; choose one from your ElevenLabs account |
| `ELEVENLABS_MODEL_ID` | unset | No | Default ElevenLabs TTS model |
| `ELEVENLABS_OUTPUT_FORMAT` | `mp3_44100_128` | No | Output codec/sample-rate/bitrate for narration audio |
| `ELEVENLABS_TIMEOUT_SECONDS` | `8` | No | Timeout for narration audio generation |
| `ELEVENLABS_STABILITY` | `0.6` | No | ElevenLabs stability tuning for narration |
| `ELEVENLABS_SIMILARITY_BOOST` | `0.75` | No | ElevenLabs voice similarity tuning for narration |
| `ELEVENLABS_STYLE` | `0.0` | No | ElevenLabs style exaggeration for narration |
| `ELEVENLABS_SPEED` | `0.95` | No | ElevenLabs speaking rate for narration |

Per-map narrator voice overrides are currently defined in code in
`backend/app/core/config.py` via `MAP_NARRATOR_VOICE_IDS`, with fallback to
`ELEVENLABS_VOICE_ID`.

`backend/.env.example` intentionally does not include a sample `ELEVENLABS_VOICE_ID`; pick one
explicitly from your ElevenLabs account when you enable narration audio.

Provider guidance:

- You do not need every provider key, only the keys required by the model aliases you configured.
- If you change model families, make sure the matching API key is present.

## Agent Memory Pipeline

The merged memory-system work expands the agent runtime beyond one decision call per turn. Memory now has three distinct behaviors:

1. Decision-time updates:
   `AgentBrain.decide` still appends a recent event for the chosen action and may add a deterministic key memory for strongly selfish decisions.
2. Observation registration:
   `AgentService.register_observation` appends a `recent_events` item and supports optional classifier-driven promotion into `key_memories`.
3. Night consolidation:
   the engine now runs asynchronous night-time reflection work across active agents, using the memory model to:
   - summarize unconsolidated recent events into a higher-level key memory once enough events accumulate
   - compress relationship history into stable relationship notes once enough interaction history exists

Important implementation detail:

- memory-specific calls now use a dedicated `memory` usage role and the `MEMORY_MODEL` / `MEMORY_FALLBACK_MODEL` pair
- the current engine records conversation and night-reflection observations with `classify=False`, then relies on consolidation passes rather than classifier-driven promotion in those paths
- relationship consolidation writes durable notes and a signature map so the same history is not repeatedly re-summarized

## Persistence And Runtime Boundaries

Persisted today:

- experiment metadata and world state
- agent state, memory, relationships, faction assignment, and influence
- unresolved plotlines and recent-event summaries
- GM plans and their approval/application status
- event log entries
- per-round world snapshots
- LLM usage records and prompt traces

Analytics, replay, and the headless report now depend on both phase events and derived round log
entries written at step time:

- `crisis_event`
- `agent_action`
- `resource_update`
- `threat_update`
- `round_end`

Still in-memory today:

- active WebSocket connection handles
- per-process broadcast fanout

This means a backend restart should preserve experiment state, but not live subscriptions.

## Backend Behavior Worth Knowing

- `step` moves `setup` experiments to `running` automatically.
- `step` does not currently require prior manual GM approval. If you need to override the next GM plan, call `GET /gm/plan` and `POST /gm/approve` before stepping.
- The WebSocket endpoint is outbound-only. Use REST for control actions like stepping, pausing, injecting events, or approving plans.
- Analytics, replay, and usage endpoints are assembled from persisted state and logs rather than from a separate reporting system.
- Usage totals and traces can now be split by `role=gm`, `role=agent`, and `role=memory`.

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
