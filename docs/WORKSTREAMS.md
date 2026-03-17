# Work Streams

Development is organized into 3 parallel work streams by layer. Stream 3 (Infrastructure) runs first to scaffold the project and unblock the other two. Streams 1 (Frontend) and 2 (Backend) develop independently against a shared API contract in `shared/schemas/`, then integrate.

```
Stream 3 (Infra)  ──starts first──>  scaffolding ready
                                         |
                            +────────────+────────────+
                            |                         |
                    Stream 1 (FE)              Stream 2 (BE)
                    uses mock API              builds real API
                            |                         |
                            +────────────+────────────+
                                         |
                                   Integration
                              (swap mocks for real,
                               end-to-end testing)
```

**Integration milestones:**
1. After S3.1 — Both streams can start developing
2. After S2.8 + S1.1 — Connect frontend to real API
3. After S2.5 + S1.3 — First end-to-end simulation with visuals
4. After all streams — Full system test on K8s

---

## Stream 1: Frontend

**Stack:** Vue 3 (Composition API), Vite, TypeScript, PixiJS v8, Pinia, WebSocket
**Depends on:** S3.1 (scaffolding), API contract in `shared/`
**Can mock:** Backend API with MSW or local JSON fixtures

### S1.1 — Project Setup & Skeleton
- Vue 3 + Vite + TypeScript project
- Install PixiJS v8, Pinia, vue-router
- Layout shell: sidebar nav, main viewport, bottom control bar
- Mock API service layer (swap to real API later)

### S1.2 — Experiment Setup Screen
- Agent configuration form: name, personality traits (sliders/tags), secret goal (text), LLM model (dropdown)
- Add/remove agents (6-12)
- Arc selection: preset picker with preview, or custom arc builder (define acts, tones, director's notes)
- Simulation parameters: round count, starting resources, escalation rate
- "Begin Experiment" button

### S1.3 — Isometric World (PixiJS)
- PixiJS Application embedded in Vue component
- Isometric tile renderer (diamond projection)
- Load town map from JSON, render terrain tiles + buildings
- Location labels and interaction zones
- Camera: pan (drag), zoom (scroll), keyboard shortcuts
- Day/night cycle lighting overlay

### S1.4 — Agent Rendering
- Agent sprite system: idle, walking, talking, working, sneaking states
- Pathfinding animation between locations (A* on tile grid)
- Speech bubbles (text popover on agent)
- Status indicators: thinking spinner, goal icon, suspicion glow
- Click-to-select with highlight ring

### S1.5 — Game UI Panels
- **Control Bar:** Play/pause/step, speed slider, round counter, auto-approve toggle, inject Observer Event button
- **Threat HUD:** Threat meter (0-100 with color gradient), resource bars (food/water/materials/power), current act label
- **Arc Timeline:** Horizontal timeline showing acts, current round position, act transitions
- **GM Plan Panel:** Before each round — show GM's theme, event, narration. Approve/modify/override buttons
- **GM Narration Overlay:** Cinematic text overlay between rounds (typewriter effect)

### S1.6 — Agent Dossier Panel
- Slide-out panel on agent click
- Sections: Identity (name, personality), Secret Goal, Inner Thoughts (latest), Action History (timeline), Relationships (trust scores with other agents), Suspicion Level (meter)
- Live updates via WebSocket

### S1.7 — Social Views
- Town Meeting view: multi-agent conversation panel, proposal display, voting interface with results
- 1-on-1 conversation bubbles in world view
- Relationship web visualization (optional)

### S1.8 — Experiment Log & Post-Game Report
- Filterable/searchable event feed: conversations, actions, crises, votes, GM decisions
- Filter by: agent, event type, round, act
- Post-game report screen: cooperation chart, goal completion table, betrayal graph, GM narration timeline, "highlight reel" of key moments

### S1.10 — ECS TypedArray Migration
- Migrate all 13 ECS components from `[] as number[]` to TypedArrays (`Types.f32`, `Types.ui8`, `Types.ui32`)
- Benchmark at 50/150/500 entities
- Spec: `docs/specs/ecs-typed-array-migration.md`
- **Depends on:** S1.3 (ECS foundation merged)

### S1.11 — ECS State Serialization
- Serialize/deserialize all ECS component data + session-owned Maps
- Support reconnect-without-refresh and round snapshots for replay
- Spec: `docs/specs/ecs-state-serialization.md`
- **Depends on:** S1.10 (TypedArray migration)

### S1.12 — Agent ECS State Bridge
- Wire Mood/Social/Inventory stub components to backend agent state via new WS messages
- New message types: `agent_mood_update`, `agent_status_update`, `agent_inventory_delta`
- Spec: `docs/specs/agent-ecs-state-bridge.md`
- **Depends on:** S2.4 (Agent System), S2.8 (WebSocket Layer)
- **Blocked on:** Backend Stream 2 active

### S1.9 — Visual Polish
- Placeholder sprite assets (buildings, agents, effects)
- Threat-based visual degradation (cracks, dim lights, debris)
- Transition animations between phases
- Sound effects (optional)
- Responsive layout
- Error states + WebSocket reconnection UI

---

## Stream 2: Backend

**Stack:** Python 3.12, FastAPI, SQLAlchemy + PostgreSQL, Redis, WebSockets, LiteLLM
**Depends on:** S3.1 (scaffolding), S3.2 (database), API contract in `shared/`

### S2.1 — Project Setup & Models
- FastAPI project with Poetry
- SQLAlchemy models: Experiment, Arc, Act, Agent, Round, Event, WorldSnapshot, GMPlan
- Alembic migrations
- Pydantic schemas matching `shared/` API contract
- Health endpoint, CORS config

### S2.2 — World System
- World map data structure: tile grid, location registry (name, type, position, capacity)
- Default town map JSON: houses, general store, well, town hall, workshop, farm, perimeter fence, mysterious locked building
- Resource system: food, water, materials, power — with depletion rates and modifiers
- Threat meter: calculation based on cooperation ratio, resource levels, crisis severity
- World state snapshot/restore for persistence

### S2.3 — Game Master System
- **Director module:** Arc/act data model, current act tracking, act transition logic
- **Preset arcs:** "Lord of the Flies" (3-act default), "Slow Burn" (5-act), "Chaos from Round 1" (2-act), "The Long Peace" (3-act)
- **AI GM agent:** LLM prompt construction (arc context + world state + agent relationships + unresolved plotlines), structured JSON output parsing
- **Event system:** Crisis templates (resource, structural, social, environmental, meta), severity scaling, event history tracking
- **GM plan flow:** Generate plan -> expose via API -> wait for approval/modification -> apply to round
- **Auto-approve mode:** Skip approval step, run continuously

### S2.4 — Agent System
- Agent model: personality traits, secret goal, memory, location, inventory, relationships (trust map), suspicion level
- **Brain:** LLM prompt builder (personality + goal + observations + memory + world state + current crisis), structured JSON response parsing
- **Memory:** Sliding window of recent events (last N rounds), key memories (flagged important), relationship tracker (trust deltas per interaction)
- **Actions:** Registry of action types — move, gather, repair, trade, talk, hoard, sabotage, explore, accuse, vote, rest, observe
- **Suspicion system:** Triggers (edge-of-map, failed actions, Observer Events, other agents' paranoia), gradual escalation

### S2.5 — Simulation Engine
- Round orchestrator: 6 phases (GM plan / dawn / morning / midday / afternoon / night)
- **GM Plan phase:** Call GM, expose plan, wait for approval
- **Dawn:** Apply resource depletion + GM modifiers, announce crisis, update threat
- **Morning (free phase):** 2 actions per agent, movement + conversations
- **Midday (town meeting):** Multi-agent conversation orchestration, proposal system, vote resolution
- **Afternoon (action phase):** 1 committed action per agent, simultaneous resolution, conflict handling
- **Night (consequences):** Results, threat adjustment, agent reflection (inner monologue LLM call), clue placement
- Cooperation scoring: track cooperate vs. selfish ratio, adjust threat meter

### S2.6 — Social System
- **Conversations:** 2-agent LLM turn-taking (agent A speaks -> agent B responds -> repeat for N turns)
- **Town meetings:** Multi-agent discussion (round-robin or popcorn-style), proposal + vote mechanics
- **Relationship updates:** After each interaction, update trust scores based on content analysis

### S2.7 — LLM Integration (LiteLLM)
- LiteLLM setup: multi-provider (Claude, GPT, Gemini, Llama)
- Per-agent model configuration
- Structured output enforcement (JSON mode / function calling)
- Rate limiting per provider
- Token usage + cost tracking per agent, per round, per experiment
- Retry logic with fallback models

### S2.8 — API & WebSocket Layer
**REST Endpoints:**
- `POST /experiments` — Create experiment config (includes arc)
- `GET /experiments/{id}` — Get experiment state
- `POST /experiments/{id}/start` — Start simulation
- `POST /experiments/{id}/pause` — Pause
- `POST /experiments/{id}/step` — Advance one round
- `POST /experiments/{id}/inject` — Inject Observer Event
- `GET /experiments/{id}/gm/plan` — Get GM's plan for next round
- `POST /experiments/{id}/gm/approve` — Approve/modify GM plan
- `PUT /experiments/{id}/arc` — Update narrative arc mid-game
- `GET /experiments/{id}/agents` — Agent states
- `GET /experiments/{id}/agents/{agent_id}/dossier` — Full agent dossier
- `GET /experiments/{id}/log` — Event log (paginated, filterable)

**WebSocket:**
- `WS /experiments/{id}/ws` — Real-time round updates, agent actions, GM narration, crisis events

---

## Stream 3: Infrastructure

**Runs first** to provide the foundation for Streams 1 & 2.

### S3.1 — Monorepo & Local Dev
- Initialize monorepo structure (`frontend/`, `backend/`, `k8s/`, `shared/`, `assets/`)
- Git repo + `.gitignore`
- `shared/` directory with JSON schemas for API contract
- Docker Compose: FastAPI backend, Vue frontend (Vite dev server), PostgreSQL, Redis
- Makefile with common commands (`make dev`, `make test`, `make build`)

### S3.2 — Database & Caching
- PostgreSQL container config + initialization scripts
- Redis container config
- Alembic migration runner in Docker
- Seed data script (default town map, preset arcs)
- Backup/restore scripts

### S3.3 — Kubernetes Manifests
- Namespace: `the-experiment`
- Frontend: Deployment + Service + Ingress (nginx-based Vite build)
- Backend: Deployment + Service + HPA (auto-scale on active experiments)
- PostgreSQL: StatefulSet + PVC + Service
- Redis: Deployment + Service
- ConfigMap + Secrets (LLM API keys, feature flags)
- Resource limits and requests

### S3.4 — CI/CD Pipeline
- GitHub Actions:
  - Lint + type-check (frontend + backend)
  - Unit tests
  - Build Docker images
  - Push to container registry
  - Deploy to K8s (staging -> production)
- Pre-commit hooks: linting, formatting

### S3.5 — Monitoring & Cost Tracking
- LLM cost tracking: per-experiment, per-agent, per-round token usage + cost
- Application metrics: active experiments, rounds processed, WebSocket connections
- Logging: structured JSON logs, centralized collection
- Health checks + readiness probes for K8s

---

## Shared API Contract

The `shared/schemas/` directory contains JSON Schema definitions that both frontend and backend develop against:

| Schema | Description |
|--------|-------------|
| `experiment.json` | Experiment configuration and state |
| `agent.json` | Agent model (personality, goal, status, relationships) |
| `arc.json` | Narrative arc with acts |
| `gm_plan.json` | AI GM's round plan |
| `agent_decision.json` | Structured agent LLM output |
| `ws_message.json` | WebSocket message format |

The frontend mocks these schemas during development. When Stream 2 delivers the real API, the frontend swaps in the real HTTP/WebSocket clients with no UI changes.
