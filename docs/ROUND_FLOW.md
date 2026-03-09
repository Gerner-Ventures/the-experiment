# Round Flow: End-to-End Execution

This document traces a single round from initiation through backend processing, WebSocket delivery, and frontend presentation. It references actual code paths.

For design intent see [GAME_DESIGN.md](./GAME_DESIGN.md). For the runtime state model see [GAME_RUNTIME.md](./GAME_RUNTIME.md). For the full API surface see [API.md](./API.md).

---

## 1. Overview

A "round" represents one day cycle in the simulation. Each experiment runs for a configurable number of rounds (default 15). A round has six sequential phases:

| # | Phase | Time of Day | Purpose |
|---|-------|-------------|---------|
| 0 | GM Plan | Pre-dawn | AI Game Master selects a theme and crisis for the round |
| 1 | Dawn | Early morning | Resources tick down, threat recalculated, crisis announced |
| 2 | Morning | Morning | Each agent takes 2 free actions (move, talk, gather, etc.) |
| 3 | Midday | Noon | Town meeting with speeches, votes, and possible exile |
| 4 | Afternoon | Afternoon | Each agent takes 1 committed action, consequences resolve |
| 5 | Night | Evening | Cooperation ratio calculated, threat recalculated, memory consolidation |

The round is initiated by `POST /api/experiments/{id}/step`, which returns immediately. The engine runs the round as a background task and streams progress over WebSocket.

---

## 2. Phase Sequence

### Phase 0: GM Plan

**Backend:** `SimulationEngine._gm_plan_phase()` in `backend/app/engine/service.py`

The GM receives a planning context built from:
- Current round number and total rounds
- The narrative arc and current act tone
- World state (resources, threat, active modifiers)
- Unresolved plotlines (last 10)
- Lightweight relationship summary across agents
- Recent events (last 5)

Two paths exist:
- **Pre-approved plan:** If an `applied` plan for this round already exists (manual approval workflow), the engine reuses it.
- **Auto-generated plan:** The engine calls `GMService.generate_plan()`, optionally auto-approves, then applies.

Outputs stored in `GMPlanRecord`:
- `round_theme` -- e.g. "Betrayal Revealed", "Resource Crisis"
- `crisis_event` -- typed crisis with `type`, `description`, `affects`, `severity`
- `resource_modifiers` -- per-resource deltas (food, water, materials, power)
- `environmental` -- flavor text for the round
- `narration` -- brief text (roughly 15-20 seconds spoken)

### Phase 1: Dawn

**Backend:** `SimulationEngine._dawn_phase()` in `backend/app/engine/service.py`

Resource changes computed from three sources:
1. **Base decay** -- systemic per-tick reduction via `ResourceTick`
2. **GM crisis modifiers** -- from the plan's `resource_modifiers`
3. **World bias** -- from `world_state.active_modifiers`

After the resource tick, threat is recalculated using:
- Current resource scarcity
- A temporary cooperation input (0.6 placeholder at dawn)
- Crisis severity

The crisis description is appended to `unresolved_plotlines` (capped at 10).

### Phase 2: Morning

**Backend:** `SimulationEngine._action_phase(phase="morning", actions_per_agent=2)` in `backend/app/engine/service.py`

Each active agent takes 2 action turns sequentially. For each turn:

1. **Context building** -- `build_agent_context()` assembles world state, crisis, local observations, agent memory, suspicion, relationships, inventory, and goal.
2. **LLM decision** -- `AgentService.decide(context)` returns an `AgentTurnResult` with action, inner thought, dialogue, cooperation intent, and goal progress.
3. **State update** -- Agent memory and suspicion update immediately.
4. **Action preparation** -- `_prepare_action()` validates and normalizes the action:
   - Movement cap: agents can move at most 2 tiles per action
   - Proximity check: interaction actions require another agent within range (2 tiles contact, 4 tiles for ranged like `shoot`)
   - Location check: some actions require specific location types (e.g. `gather` at farms/water sources, `repair` at workshops)
   - Failed actions fall back to `observe` with a suspicion bump
5. **Hook broadcast** -- `hook.on_agent_action()` fires per turn, sending `agent_action` over WebSocket.

Special case: if an action resolves as `self_sacrifice`, the agent is marked `dead`, a terminal event is recorded, and the agent is removed from all future phases.

Actions are prepared sequentially, not from a frozen start-of-phase snapshot. If one agent moves early, later proximity checks see the updated position.

After all agents act, `_resolve_actions()` groups prepared actions by `(location, action_type)` and resolves:
- **Talk groups** (2+ agents talking at same location) trigger `SocialService.run_conversations()` producing conversation summaries with trust deltas
- **Competing groups** (gather, hoard, repair, explore, accuse, vote) resolve as conflicts with winners and losers
- **Hostile actions** (attack, threaten, stab, shoot, poison) may enqueue consequence actions for targets
- **Resource effects** applied: gather (+food/water), repair (-materials/+power), hoard (-shared food), sabotage (-power)

### Phase 3: Midday

**Backend:** `SimulationEngine._midday_phase()` in `backend/app/engine/service.py`

The town meeting runs through `SocialService.run_meeting()`:

1. **Proposal generation** -- `_meeting_proposal()` selects a topic from current state
2. **Speeches** -- Each active agent delivers a speech with a stance (support, oppose, hesitant)
3. **Votes** -- Each active agent votes (support, oppose, abstain) with a rationale
4. **Meeting summary** -- Outcome computed including tally and pass/fail
5. **Relationship updates** -- `_apply_meeting_relationships()` adjusts agent relationships based on voting alignment
6. **Faction events** -- `_faction_events()` generates faction formation or update events
7. **Exile resolution** -- `_apply_exile_outcome()` may exile an agent based on vote results

Dead or exiled agents are excluded from the meeting.

### Phase 4: Afternoon

**Backend:** `SimulationEngine._action_phase(phase="afternoon", actions_per_agent=1)` in `backend/app/engine/service.py`

Same mechanics as Morning but with 1 action per agent. Hostile actions may enqueue follow-up consequence actions for the target immediately after the aggressor resolves.

### Phase 5: Night

**Backend:** `SimulationEngine._night_phase()` in `backend/app/engine/service.py`

1. **Cooperation ratio** -- Calculated from all morning + afternoon agent turns
2. **Threat recalculation** -- `calculate_threat_level()` using actual cooperation ratio, resources, and crisis severity
3. **Night reflections** -- All active agents run concurrently via `asyncio.gather()`:
   - `agent_service.register_observation()` -- logs a mood-based reflection
   - `agent_service.consolidate_memory()` -- prunes and compresses episodic memory
   - `agent_service.consolidate_relationship_memory()` -- updates relationship state
4. **State sync** -- `agent.relationships` updated from consolidated `relationship_memory`

---

## 3. Backend Execution

Entry point: `POST /api/experiments/{id}/step` in `backend/app/api/routes/experiments.py`

The route handler:
1. Validates the experiment exists and is not already stepping
2. In manual mode (`auto_approve=false`), returns 409 if no approved GM plan exists
3. Returns immediately with `{"status": "step_started", "round_number": N}`
4. Launches `ExperimentRuntime._run_step()` as a background task

The background task:
1. Builds a `StreamingHook` via `RuntimeStreamBroadcaster.build_hook(experiment_id)`
2. Calls `SimulationEngine.run_round(state, hook=streaming_hook)`
3. The engine calls hook methods at each phase boundary and per-agent-action
4. After `run_round()` returns, the runtime calls `broadcast_round_end()`
5. State is persisted through `SqlAlchemyExperimentStore`
6. A `world_snapshots` row is written with the full `WorldState`
7. Derived log entries are persisted: `crisis_event`, `agent_action`, `resource_update`, `threat_update`, `round_end`

If the round fails, a `step_error` message is broadcast over WebSocket.

### Hook Call Order in `run_round()`

```
h.on_round_start(round_number, gm_plan)
h.on_phase_start(round_number, "gm_plan")
h.on_phase_complete(round_number, gm_result)

h.on_phase_start(round_number, "dawn")
h.on_phase_complete(round_number, dawn_result)

h.on_phase_start(round_number, "morning")
  h.on_agent_action(...)   # per agent, per turn (2 turns each)
h.on_phase_complete(round_number, morning_result)

h.on_phase_start(round_number, "midday")
h.on_phase_complete(round_number, midday_result)

h.on_phase_start(round_number, "afternoon")
  h.on_agent_action(...)   # per agent (1 turn each)
h.on_phase_complete(round_number, afternoon_result)

h.on_phase_start(round_number, "night")
h.on_phase_complete(round_number, night_result)
```

---

## 4. WebSocket Message Flow

Connection: `ws://localhost:8000/api/experiments/{experiment_id}/ws`

The `StreamingHook` in `backend/app/api/services/streaming.py` translates engine hook calls into WebSocket broadcasts. Below is the complete message sequence for one round.

### Round Start Burst (from `on_round_start`)

| Order | Message Type | Payload |
|-------|-------------|---------|
| 1 | `round_start` | `{ theme }` |
| 2 | `gm_plan` | Full `GMPlanRecord` |
| 3 | `crisis_event` | Crisis event with `type`, `description`, `affects`, `severity` |
| 4 | `gm_audio_status` | Narration TTS status (`pending`, `ready`, `error`) |

### Per-Phase Pattern (repeats for each of the 6 phases)

| Order | Message Type | Trigger | Payload |
|-------|-------------|---------|---------|
| 1 | `phase_change` | `on_phase_start` | `{ status: "starting" }` with `phase` field set |
| 2 | `agent_action` | `on_agent_action` (morning/afternoon only) | Agent decision, inner thought, speech text, action details |
| 3 | `phase_change` | `on_phase_complete` | `{ events: [...] }` with full phase event list |
| 4 | Various | Per-event extraction | `meeting_start`, `meeting_speech`, `meeting_vote`, `meeting_result`, `agent_speak`, `faction_update`, `cult_activity`, `exile_vote`, `exile_result` |
| 5 | `agent_speech_audio` | After speech text extraction | TTS audio status per agent utterance |

The `on_phase_complete` handler iterates through phase events and broadcasts typed messages for recognized event kinds (meeting events, faction events, exile events, agent speak events, consequence actions).

### Round End Sequence (from `broadcast_round_end`)

| Order | Message Type | Payload |
|-------|-------------|---------|
| 1 | `resource_update` | `{ food, water, materials, power }` |
| 2 | `threat_update` | `{ threat_level }` |
| 3 | `round_end` | `{ status, current_round, total_rounds, threat_level, resources, agents[] }` |
| 4 | `experiment_end` | Only if status is `completed` or `collapsed`: `{ status, total_rounds }` |

The `round_end` message is the authoritative end-of-round state snapshot. Clients should treat it as the sync point for experiment status, resources, threat, and agent locations.

### Message Envelope

All messages share the envelope defined in `shared/schemas/ws_message.json`:

```json
{
  "type": "<WSMessageType>",
  "round": 1,
  "phase": "morning",
  "timestamp": "2026-03-07T12:00:00Z",
  "is_consequence": false,
  "data": { ... }
}
```

---

## 5. Frontend Processing

### WebSocket Routing

`useWebSocket()` in `frontend/src/composables/useWebSocket.ts` parses every incoming message and calls `routeMessage()`, which dispatches to the appropriate Pinia store handler:

| Message Type | Store | Handler |
|-------------|-------|---------|
| `round_start` | `experiment` | `onRoundStart()` |
| `round_end` | `experiment` | `onRoundEnd()` |
| `phase_change` | `experiment` | `onPhaseChange()` |
| `gm_plan` | `gm` | `onPlan()` |
| `gm_audio_status` | `gm` | `onAudioStatus()` |
| `agent_action` | `agent` | `onAction()` |
| `agent_speak` | `social` | `onSpeak()` |
| `agent_speech_audio` | `social` | `onSpeechAudio()` |
| `crisis_event` | `world` | `onCrisis()` |
| `threat_update` | `world` | `onThreatUpdate()` |
| `resource_update` | `world` | `onResourceUpdate()` |
| `meeting_start` | `social` | `onMeetingStart()` |
| `meeting_speech` | `social` | `onMeetingSpeech()` |
| `meeting_vote` | `social` | `onMeetingVote()` |
| `meeting_result` | `social` | `onMeetingResult()` |
| `experiment_end` | `experiment` | `onEnd()` |
| `step_error` | `ui` | `clearStepping()` |

Every message is also logged to `experimentStore.events` via `addEvent()` (capped at 500 entries).

### Turn Queue: Filling and Draining

The turn store (`frontend/src/stores/turn.ts`) serializes all agent-visible activity into an ordered animation queue.

**Filling the queue:**
- `agentStore.onAction()` receives `agent_action` messages and calls `turnStore.enqueue()` with action type, target location, speech text, and source.
- `socialStore.onMeetingSpeech()` enqueues each meeting speech as a turn with `actionType: 'meeting_speech'`.
- `socialStore.onMeetingVote()` enqueues each vote as a turn with `actionType: 'meeting_vote'`.

**Draining the queue (per turn):**

Each turn goes through these phases in `processNext()`:

1. **HUD update** -- Status bar shows agent name and action type.
2. **Thinking phase** (if turn has `thought`) -- Agent marked as `thinking`, speech bubble displayed via `addConversation()`. Waits for audio playback to complete or `AUDIO_MAX_TIMEOUT_MS` (15s).
3. **Movement phase** -- If `targetLocation` differs from agent's current location, the PixiJS world animates the agent moving. Speech-only actions (`meeting_speech`, `meeting_vote`) skip movement entirely.
4. **Action phase** -- Sprite animation plays (mapped via `ACTION_TO_ANIMATION`). Dual-gated: both the animation callback and `MIN_ACTION_DURATION_MS` (1.5s) must complete. Actions in `SKIP_ACTION_PHASE` skip this.
5. **HUD-only phase** (if no thought) -- Shows status for `HUD_ONLY_DURATION_MS` (1.5s).
6. **Finish** -- Agent set to `idle`, then `TURN_GAP_MS` (400ms) pause before the next turn.

When the queue empties, all registered `drainedHandlers` fire.

### Phase Indicator Updates

`experimentStore.onPhaseChange()` updates `currentPhase` immediately and calls `worldStore.onPhaseChange()` for day/night rendering. The HUD status label is set based on phase name. If a meeting is active, HUD updates are deferred until the meeting dismisses (to avoid breaking immersion with labels like "Afternoon starting..." while the meeting overlay is visible).

### When Meetings Trigger

1. `meeting_start` message arrives during midday phase.
2. `socialStore.onMeetingStart()` initializes `MeetingState` with `active: true` and `scenePhase: 'entering'`.
3. The `MeetingScene` component reacts to `isMeetingActive` and renders the overlay.
4. Speech and vote messages arrive and are enqueued as turns; `MeetingScene` owns phase progression through `entering -> proposal -> speeches -> voting -> result -> exile -> exiting`.
5. `meeting_result` populates the result/tally but does not advance the scene phase.
6. After the scene completes, `dismissMeeting()` sets `active: false`.

### Round End Synchronization

`experimentStore.onRoundEnd()` uses `waitForReady()` to defer finalization until both:
- The turn queue has fully drained (all animations complete)
- The meeting scene has been dismissed

Only then does it update agent state from the `round_end` payload, increment `completedRounds`, and clear the stepping status. This prevents the UI from jumping ahead while animations or the meeting overlay are still active.

---

## 6. Timing and Concurrency

### Backend: Sequential vs Concurrent

| Step | Execution Model |
|------|----------------|
| GM plan generation | Single async call |
| Dawn resource tick | Synchronous computation |
| Morning/Afternoon agent decisions | Sequential per agent (position-dependent) |
| Morning/Afternoon action resolution | Grouped by (location, action_type), resolved sequentially |
| Midday meeting | Single synchronous call to `SocialService.run_meeting()` |
| Night reflections | Concurrent via `asyncio.gather()` across all active agents |
| Night threat recalculation | Synchronous after reflections complete |

Key detail: agent action preparation within a phase is sequential because movement updates positions that later agents' proximity checks depend on. Night reflections are safe to parallelize because they only read agent state and write back independently.

### Frontend: Animation Pacing

| Timing Constant | Value | Purpose |
|----------------|-------|---------|
| `MIN_ACTION_DURATION_MS` | 1500ms | Floor time for action animations so players can register what happened |
| `HUD_ONLY_DURATION_MS` | 1500ms | Display time for actions with no speech bubble |
| `AUDIO_MAX_TIMEOUT_MS` | 15000ms | Maximum wait for TTS audio before force-advancing |
| `TURN_GAP_MS` | 400ms | Pause between consecutive turns |

The frontend can receive all WebSocket messages for a phase before the previous phase's turn queue has drained. Messages are buffered in the queue and processed in order. Phase changes and round end are gated behind `waitForReady()`.

### Timeout and Error Handling

- If a background round fails, the backend broadcasts `step_error` and the frontend clears the stepping state.
- WebSocket reconnection uses exponential backoff: `min(1000 * 2^(attempts-1), 30000)` ms.
- Reconnecting clients should fetch a fresh REST snapshot (`GET /api/experiments/{id}`) to resync.
- `POST /api/experiments/{id}/step` returns 409 if a round is already in progress.

---

## 7. ASCII Flow Diagram

```
 REST: POST /step
      |
      v
 [Background Task]
      |
      v
 +-----------------------+
 | on_round_start        |------> WS: round_start
 |                       |------> WS: gm_plan
 |                       |------> WS: crisis_event
 |                       |------> WS: gm_audio_status
 +-----------------------+
      |
      v
 +-- GM PLAN PHASE ------+
 | on_phase_start        |------> WS: phase_change {status:"starting", phase:"gm_plan"}
 | engine generates plan  |
 | on_phase_complete     |------> WS: phase_change {events:[...]}
 +-----------------------+
      |
      v
 +-- DAWN PHASE ---------+
 | on_phase_start        |------> WS: phase_change {status:"starting", phase:"dawn"}
 | resource tick          |
 | threat recalc          |
 | on_phase_complete     |------> WS: phase_change {events:[crisis narration]}
 +-----------------------+
      |
      v
 +-- MORNING PHASE ------+
 | on_phase_start        |------> WS: phase_change {status:"starting", phase:"morning"}
 |                       |
 | for each agent (x2):  |
 |   LLM decide          |
 |   prepare action       |
 |   on_agent_action     |------> WS: agent_action {agent, action, thought}
 |                       |
 | resolve actions        |
 |   conversations        |------> WS: agent_speak (via phase_complete events)
 |   conflicts            |
 |   resource effects     |
 | on_phase_complete     |------> WS: phase_change {events:[...]}
 +-----------------------+
      |
      v
 +-- MIDDAY PHASE -------+
 | on_phase_start        |------> WS: phase_change {status:"starting", phase:"midday"}
 |                       |
 | run_meeting()          |
 |   proposal             |
 |   speeches             |
 |   votes                |
 |   result               |
 |   exile check          |
 |   faction events       |
 |                       |
 | on_phase_complete     |------> WS: phase_change {events:[...]}
 |   event extraction    |------> WS: meeting_start
 |                       |------> WS: meeting_speech (per agent)
 |                       |------> WS: meeting_vote (per agent)
 |                       |------> WS: meeting_result
 |                       |------> WS: exile_vote / exile_result (if applicable)
 |                       |------> WS: faction_update / cult_activity (if applicable)
 +-----------------------+
      |
      v
 +-- AFTERNOON PHASE ----+
 | on_phase_start        |------> WS: phase_change {status:"starting", phase:"afternoon"}
 |                       |
 | for each agent (x1):  |
 |   LLM decide          |
 |   prepare action       |
 |   on_agent_action     |------> WS: agent_action
 |                       |
 | resolve actions        |
 |   hostile consequences |
 | on_phase_complete     |------> WS: phase_change {events:[...]}
 +-----------------------+
      |
      v
 +-- NIGHT PHASE --------+
 | on_phase_start        |------> WS: phase_change {status:"starting", phase:"night"}
 |                       |
 | calc cooperation ratio |
 | recalc threat          |
 | agent reflections      |  (concurrent via asyncio.gather)
 |   register observation |
 |   consolidate memory   |
 |   consolidate rels     |
 | on_phase_complete     |------> WS: phase_change {events:[reflections]}
 +-----------------------+
      |
      v
 +-- ROUND FINALIZE -----+
 | update experiment      |
 | status                 |
 | persist state          |
 | broadcast_round_end   |------> WS: resource_update
 |                       |------> WS: threat_update
 |                       |------> WS: round_end  (authoritative sync)
 |                       |------> WS: experiment_end (if game over)
 +-----------------------+
      |
      v
 [Frontend]
      |
      +---> experimentStore.onRoundEnd()
      |       waitForReady() -- blocks until:
      |         1. turnStore queue fully drained
      |         2. meeting scene dismissed
      |       then: sync agents, increment completedRounds, clear HUD
      |
      v
   [Ready for next round]
```

---

## Code References

| Component | Path |
|-----------|------|
| Engine round orchestrator | `backend/app/engine/service.py` -- `SimulationEngine.run_round()` |
| Engine models and hook protocol | `backend/app/engine/models.py` -- `RoundHook`, `PhaseResult`, `RoundEvent` |
| Streaming hook (WS emission) | `backend/app/api/services/streaming.py` -- `StreamingHook` |
| Round-end broadcast | `backend/app/api/services/streaming.py` -- `RuntimeStreamBroadcaster.broadcast_round_end()` |
| Runtime background task | `backend/app/api/runtime.py` -- `ExperimentRuntime._run_step()` |
| World resource/threat logic | `backend/app/world/service.py` -- `apply_resource_tick()`, `calculate_threat_level()` |
| Action catalog | `backend/app/actions/` |
| Social service (meetings) | `backend/app/social/` -- `SocialService.run_meeting()` |
| WS message schema | `shared/schemas/ws_message.json` |
| Frontend WS composable | `frontend/src/composables/useWebSocket.ts` |
| Frontend WS types | `frontend/src/types/websocket.ts` |
| Experiment store | `frontend/src/stores/experiment.ts` |
| Turn queue store | `frontend/src/stores/turn.ts` |
| Social/meeting store | `frontend/src/stores/social.ts` |
| Agent store (action handler) | `frontend/src/stores/agent.ts` |
