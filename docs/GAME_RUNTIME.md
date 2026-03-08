# Game Runtime

This document describes the current runtime model and round execution implemented in the backend.

For design intent, player fantasy, and planned mechanics, see [GAME_DESIGN.md](./GAME_DESIGN.md).

## Purpose

The runtime is centered on a single canonical state object:

- `SimulationState` in `backend/app/engine/models.py`

That object is the source of truth for:

- experiment metadata and lifecycle
- world resources and threat
- agent runtime state
- GM plan for the current or next round
- unresolved plotlines and recent events
- faction and exile history
- sacrifice history

## State Model

### Simulation State

`SimulationState` contains the top-level runtime state for one experiment.

Key fields:

- `experiment_id`, `experiment_name`
- `total_rounds`, `current_round`, `status`
- `auto_approve`
- `arc`
- `world_state`
- `agents`
- `unresolved_plotlines`
- `recent_events`
- `gm_plan`
- `factions`
- `exile_history`
- `sacrifice_history`

Code reference:

- `backend/app/engine/models.py`

### World State

`WorldState` contains the shared environmental state:

- `map_name`
- `round_number`
- `resources`
- `threat_level`
- `active_modifiers`
- `location_occupancy`

`resources` is a `ResourceState` with four shared pools:

- `food`
- `water`
- `materials`
- `power`

Code references:

- `backend/app/world/models.py`
- `backend/app/world/service.py`

### Agent State

Each agent is stored as an `EngineAgentState`.

Important runtime fields:

- `status`
- `personality`
- `goal`
- `memory`
- `location`
- `tile_x`, `tile_y`
- `inventory`
- `relationships`
- `suspicion_level`
- `faction_id`, `faction_role`
- `influence`
- `death_round`, `death_cause`

Suspicion is per-agent, not global.

Code reference:

- `backend/app/engine/models.py`

## Persistence

The API runtime persists state through `SqlAlchemyExperimentStore`.

Current state is stored primarily in the `experiments` row:

- `status`
- `current_round`
- `total_rounds`
- `threat_level`
- `resources`
- `world_state`
- `unresolved_plotlines`
- `recent_events`
- `factions`
- `exile_history`
- `sacrifice_history`

Agent runtime state is stored in `agents` rows, including:

- personality and goal JSON
- memory JSON
- relationships JSON
- suspicion
- location and status
- faction role/influence
- death metadata for terminal outcomes

GM plans are stored in `gm_plans`.

At the end of each round, a `world_snapshots` row is also written with the full `WorldState`.

The event log also stores derived round entries that sit alongside the phase events:

- `crisis_event`
- `agent_action`
- `resource_update`
- `threat_update`
- `round_end`

Those derived entries are what the analytics summary, highlight feed, replay index, and headless
runner use when they compute cooperation, surface notable moments, or summarize a finished run.

Code references:

- `backend/app/api/store.py`
- `backend/app/db/models.py`

## App Wiring

The FastAPI entry point now builds the backend through `create_app(...)` in
`backend/app/main.py`.

Current wiring behavior:

- the selected `ExperimentRuntime` is attached to `app.state.runtime`
- route handlers and the websocket endpoint resolve runtime access from app state
- default app startup uses `SqlAlchemyExperimentStore`
- `BACKEND_RUNTIME_MODE=smoke_mock` swaps in the deterministic smoke GM/agent services while still
  using Postgres persistence

That split is what allows the local backend E2E smoke path to validate the real HTTP/websocket
stack without requiring live provider credentials.

## Round Execution

The implemented loop lives in `SimulationEngine.run_round()` in `backend/app/engine/service.py`.

Each round currently executes these phases in order:

1. `gm_plan`
2. `dawn`
3. `morning`
4. `midday`
5. `afternoon`
6. `night`

### 1. GM Plan

The GM receives a planning context built from:

- current round and total rounds
- arc
- current `world_state`
- current threat
- unresolved plotlines
- a lightweight relationship summary
- recent events

The engine generates a `GMPlanRecord`, approves it if needed, then applies it.

Outputs:

- round theme
- crisis event
- resource modifiers
- environmental flavor
- narration

### 2. Dawn

The dawn phase applies the round's environmental pressure.

Resource changes are computed from:

- base decay from `ResourceTick`
- GM crisis modifiers
- world bias from `world_state.active_modifiers`

After the resource tick, threat is recalculated from:

- current resource scarcity
- a temporary cooperation input
- crisis severity

The crisis description is appended to `unresolved_plotlines`.

### 3. Morning

Each active agent receives 2 action turns.

For each turn, the agent context includes:

- current world state
- the active crisis
- local observations
- the agent's memory, suspicion, relationships, inventory, and goal

The chosen action updates agent state immediately:

- memory
- suspicion
- location

If an action resolves as `self_sacrifice`, the engine marks the agent `dead`, records a
terminal event, appends a `sacrifice_history` entry, and removes the agent from future
action/meeting/night-active sets.

Actions are then resolved in groups by `(location, action_type)`.

### 4. Midday

The simulation runs a town meeting.

This phase currently handles:

- proposal generation
- speeches
- votes
- meeting summary
- relationship changes based on voting alignment

Only active agents participate. Dead or exiled agents are excluded from the meeting flow.

### 5. Afternoon

Each active agent receives 1 additional action turn.

Resolution uses the same grouping and consequence system as the morning phase.

### 6. Night

The engine computes a round-wide cooperation ratio from agent actions, then recalculates threat using:

- current resources
- the actual cooperation ratio
- crisis severity

Each active agent then receives a night reflection. Memory and relationship memory are consolidated at this stage.

## Resource Mutation Rules

Resources change in two places:

### Dawn Tick

The dawn tick applies systemic change:

- food decays
- water decays
- materials decay
- power decays
- GM crisis modifiers shift those values
- world bias can further shift them

### Action Resolution

Agent actions can also modify shared resources:

- `gather`: increases food and water
- `repair`: decreases materials, increases power
- `hoard`: decreases shared food
- `sabotage`: decreases power
- `self_sacrifice`: increases food and materials, decreases threat, and removes the actor from future active play

Conflicts on the same action/location can produce winner-based resolution with a small chaotic bonus for winners.

## Action Hardening Rules

The engine now applies a validation and normalization pass before action resolution.

One implementation detail matters here: action preparation is sequential inside a phase, not simultaneous from a frozen start-of-phase snapshot. If one agent moves early in the preparation loop, later proximity checks in that same phase will see the updated position.

### Tile-Based Position

Agents track both:

- a coarse `location` label for events and UI
- an exact tile position with `tile_x` / `tile_y` for movement and range checks

Initial spawns are distributed across the available entry tiles for a location so agents do not all begin stacked on the exact same coordinate.

### Movement Cap

Movement is capped per action. If an agent chooses a distant location, the engine moves the agent only partway toward that destination.

If the destination is too far away to reach this turn:

- the original action does not fire yet
- the turn resolves as `move`
- the event summary describes the agent as traveling toward the destination

### Proximity Checks

Agent-to-agent actions require another active agent within range.

Examples:

- `talk`
- `trade`
- `accuse`
- `attack`
- `threaten`
- `stab`
- `shoot`
- `poison`
- `argue`
- `investigate`

Most of these use a short contact range. `shoot` is treated as a longer-range interaction.

`vote` is not proximity-gated during freeform action phases. The canonical vote system still happens in the structured midday meeting, while ad hoc `vote` actions mainly act as meeting-hall positioning or intent signals.

### Location Sanity Checks

Some actions are restricted to compatible location types.

Current examples:

- `gather` requires resource-oriented locations such as farms, water sources, or stores
- `repair` requires infrastructure-oriented locations such as workshops, meeting halls, boundary areas, or mystery structures
- `vote` requires a meeting hall

### Failed Action Fallback

If an action fails hardening checks:

- the action resolves as `observe`
- the agent gains a `failed_action` suspicion bump
- the failure is appended to recent memory

## Threat Calculation

Threat is a derived value in the range `0..100`.

The current formula combines:

- baseline pressure
- scarcity pressure from low resources
- cooperation pressure from low cooperation
- crisis pressure from GM crisis severity

The implementation is in `calculate_threat_level()` in `backend/app/world/service.py`.

Important detail: threat is recalculated at dawn and again at night.

## Suspicion and Social State

Suspicion is tracked per agent as `suspicion_level`.

It can increase from:

- agent decisions returned by the agent service
- losing conflicts
- observer events injected by the player

Relationship state is stored per agent in `relationships` and is updated through:

- conversations
- meeting vote alignment or disagreement
- memory consolidation at night

## Websocket Flow

`ExperimentRuntime.broadcast_round()` emits the runtime state to the frontend over websockets.

Core messages include:

- `round_start`
- `gm_plan`
- `crisis_event`
- `phase_change`
- `agent_speak`
- `meeting_start`
- `meeting_speech`
- `meeting_vote`
- `meeting_result`
- `agent_action`
- `agent_move`
- `resource_update`
- `threat_update`
- `round_end`
- `experiment_end`

The frontend mirrors this in separate UI stores:

- `experiment` store for round, phase, and event log
- `gm` store for plan and narration
- `world` store for resources, threat, and active crisis

Code references:

- `backend/app/api/runtime.py`
- `frontend/src/stores/experiment.ts`
- `frontend/src/stores/gm.ts`
- `frontend/src/stores/world.ts`

## Analytics Persistence

The API runtime now persists report-grade derived analytics at round end:

- `agent_action` log rows include both requested and resolved action types
- `round_end` log rows include compact round summaries for cooperation, goals, suspicion, factions, and GM context
- replay and analytics endpoints read from those persisted summaries instead of reconstructing everything from websocket-only state
- the highlight reel endpoint combines both sources: event-log rows drive crisis, betrayal, and close-vote moments, while `round_end` summaries drive resource swings, alliance shifts, and suspicion spikes

## Runtime Ownership

There are five execution entry points in the repo:

- FastAPI route handlers in `backend/app/api/routes/experiments.py`
- `ExperimentRuntime` plus its websocket connection manager in `backend/app/api/runtime.py`
- `ExperimentStore` implementations in `backend/app/api/store.py`
- `ExperimentRunner` in `backend/app/engine/runner.py`
- `python -m app.headless.cli` in `backend/app/headless/cli.py`

`backend/app/main.py` only wires the FastAPI application and middleware; it does not construct a separate runner stack.
The API runtime plus store boundary is the main current path. The headless runner intentionally
reuses `ExperimentRuntime` with the in-memory store so it exercises the same orchestration and log
assembly logic without requiring backend infrastructure. The new backend E2E smoke path instead
uses the real FastAPI app plus Postgres to catch wiring, persistence, and websocket regressions
that the headless path cannot see. If these paths diverge, this document should track the API
runtime behavior.

This document describes the current implementation, not a guaranteed long-term contract.
