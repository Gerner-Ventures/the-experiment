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

Infrastructure and persistence notes live in [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md).

## Architecture

```
the-experiment/
├── frontend/          Vue 3 + PixiJS isometric renderer
├── backend/           Python (FastAPI) simulation engine
├── k8s/               Kubernetes deployment manifests
├── shared/schemas/    JSON Schema API contracts
├── assets/            Sprite sheets, tiles, sounds
└── docs/              Design docs and work stream details
```

| Layer | Stack |
|-------|-------|
| Frontend | Vue 3, Vite, TypeScript, PixiJS v8, Pinia |
| Backend | Python 3.12, FastAPI, SQLAlchemy, LiteLLM |
| Data | PostgreSQL 16, Redis 7 |
| Infra | Docker Compose (local), Kubernetes (prod) |

## Quick Start

```bash
# Clone
git clone https://github.com/Gerner-Ventures/the-experiment.git
cd the-experiment

# Copy env file
cp backend/.env.example backend/.env
# Edit backend/.env with your LLM API keys

# Start everything
make dev
```

To enable local Ruff autofixes before each commit, run `pre-commit install`.

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Health check: http://localhost:8000/health

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
