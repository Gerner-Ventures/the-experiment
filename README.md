# the-experiment

A simulation game where 6-12 AI agents wake up in a small isometric town with no memory of how they got there. Someone is watching. Resources are dwindling. Each agent has a secret goal. The town will collapse if they don't cooperate — but cooperation means sacrificing personal ambition.

**Lord of the Flies meets The Truman Show.** You are The Scientist.

## The Game

Agents are dropped into a town with shared resources that deplete every round. A **threat meter** tracks how close the town is to collapse. Each round, agents choose: contribute to survival, or pursue their secret goal. The tension between selfishness and cooperation drives the entire simulation.

A **Layered Game Master** system controls the narrative:
- **The Director (you)** sets a narrative arc — acts with tones and instructions
- **The AI GM** operates within your arc, generating round themes, crisis events, and narration
- You can approve, modify, or override the GM's plans each round

See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for the full game loop and mechanics.
API usage and endpoint details live in [docs/API.md](docs/API.md).
Backend architecture, setup, and configuration live in [docs/BACKEND.md](docs/BACKEND.md).
Backend action catalog ownership lives in [docs/ACTION_CATALOG.md](docs/ACTION_CATALOG.md).
Audio narration architecture lives in [docs/AUDIO_NARRATION.md](docs/AUDIO_NARRATION.md).
Infrastructure and persistence notes live in [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md).

## Architecture

```
the-experiment/
├── frontend/          Vue 3 + PixiJS isometric renderer
├── backend/           Python (FastAPI) simulation engine
├── chart/             Helm chart for Kubernetes deployment
├── shared/schemas/    JSON Schema API contracts
├── assets/            Sprite sheets, tiles, sounds
└── docs/              Design docs and work stream details
```

| Layer | Stack |
|-------|-------|
| Frontend | Vue 3, Vite, TypeScript, PixiJS v8, Pinia |
| Backend | Python 3.13, FastAPI, SQLAlchemy, LiteLLM |
| Data | PostgreSQL 16, Redis 7 |
| Infra | Docker Compose (local), Helm on Kubernetes (prod) |

## Infrastructure Status

- HTTP API is served at `/api/*` in both local and production environments.
- Kubernetes ingress routes `/api` to the backend service and `/` to the frontend service.
- `DATABASE_URL` and `REDIS_URL` are configuration inputs for the backend.
- Experiment state is persisted through the backend store boundary, with Postgres as the durable store for experiment state, logs, GM plans, and round snapshots.
- Active WebSocket connections are still process-local, and Redis is not yet used for multi-pod fanout.

## Quick Start

```bash
# Clone
git clone https://github.com/Gerner-Ventures/the-experiment.git
cd the-experiment

# Install dependencies and git hooks
make setup

# Option A: With Doppler (recommended — manages secrets centrally)
# Install Doppler: https://docs.doppler.com/docs/install-cli
# Then authenticate: doppler login
make dev-detached

# Option B: Without Doppler (local .env file)
make env
# Edit backend/.env with your DATABASE_URL, REDIS_URL, and any LLM API keys
make dev-detached

# Apply database migrations before creating experiments
make migrate
```

**Git hooks** are installed automatically by `make setup`. They live in `.githooks/` and include:

- **pre-commit**: ESLint + vue-tsc (frontend), ruff check + format (backend)
- **pre-push**: Jest (frontend), pytest (backend)
- **commit-msg**: enforces [Conventional Commits](https://www.conventionalcommits.org/) format

To reinstall hooks manually: `make install-hooks`

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/api
- Health check: http://localhost:8000/api/health
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- Backend guide: [docs/BACKEND.md](docs/BACKEND.md)

## Codex Skills

This repo includes in-repo Codex skills under `.codex/skills/`.

- Use `$backend` for backend-only implementation and review work.
- Use `$address-feedback <number>` to address GitHub PR feedback, push one update commit, and post the follow-up responses on GitHub.
- Use `$pr-review <number>` to review a GitHub pull request and submit the actual review on GitHub.

### Headless Backend Simulation

You can run the backend round loop without starting the backend stack:

```bash
make headless HEADLESS_ROUNDS=2 HEADLESS_SEED=11
```

This uses the in-memory runtime path and prints a round-by-round summary. `mock` mode is the
default no-setup path; add `--mode live` only when the relevant provider API keys are available in
your shell environment. If you want the raw report too, add
`HEADLESS_JSON_OUT=/tmp/headless-report.json`.

### Local Backend E2E Smoke

Use this path when you need the real FastAPI app, real HTTP routes, websockets, and Postgres-backed
persistence instead of the fast in-memory headless runner.

```bash
make migrate
BACKEND_RUNTIME_MODE=smoke_mock make backend-run
make backend-e2e
```

Notes:

- `backend-run` starts `uvicorn app.main:app` from `backend/`
- `backend-e2e` drives `/api/health`, experiment creation, GM plan approval, one round step, log,
  analytics, replay, snapshot, and websocket assertions against `http://127.0.0.1:8000` by default
- this workflow requires local Postgres via `DATABASE_URL`
- `smoke_mock` is the repeatable no-provider-key mode; use `BACKEND_RUNTIME_MODE=smoke_live` only
  when you intentionally want the live LLM-backed services

## Work Streams

Development is split into 3 parallel work streams. See [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md) for the full breakdown.

| Stream | Focus | Issues |
|--------|-------|--------|
| [Stream 1: Frontend](docs/WORKSTREAMS.md#stream-1-frontend) | Vue 3 + PixiJS isometric world, all UI | S1.1 — S1.9 |
| [Stream 2: Backend](docs/WORKSTREAMS.md#stream-2-backend) | FastAPI engine, GM system, agents, LLM | S2.1 — S2.8 |
| [Stream 3: Infrastructure](docs/WORKSTREAMS.md#stream-3-infrastructure) | Docker, K8s, CI/CD, monitoring | S3.1 — S3.5 |

Stream 3 runs first to scaffold the monorepo and unblock the other two. Streams 1 and 2 develop independently against a shared API contract (`shared/schemas/`), then integrate.

## License

TBD
