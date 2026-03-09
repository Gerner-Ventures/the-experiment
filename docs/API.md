# Backend API Guide

This project exposes a FastAPI backend for experiment control, analytics, replay data, and a server-push WebSocket stream for live round updates.

## Base URLs

- Backend API base path: `http://localhost:8000/api`
- Interactive Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI schema: `http://localhost:8000/openapi.json`

## State Model

Experiment statuses:

- `setup`: experiment exists but has not advanced a round yet
- `running`: simulation is actively stepping through rounds
- `paused`: experiment is stopped between rounds
- `completed`: total rounds were exhausted
- `collapsed`: threat reached the failure threshold

GM plan statuses:

- `pending`: generated but not yet approved/applied
- `approved`: approved without a custom replacement payload
- `modified`: approved with a replacement payload
- `applied`: the plan was applied to the round that ran

Important behavior:

- `POST /api/experiments/{id}/step` will move an experiment from `setup` to `running` automatically.
- When `auto_approve=false`, `POST /api/experiments/{id}/step` returns `409` until you have generated and approved the upcoming GM plan.
- Experiment state, GM plans, event logs, round snapshots, faction state, exile history, and sacrifice history are persisted through the store boundary.
- The WebSocket stream is server-push only. Control actions still go through REST.

## Typical Flow

1. `POST /api/experiments` to create an experiment.
2. Optional: `GET /api/experiments/{experiment_id}/gm/plan` to inspect the next GM plan.
3. Optional: `POST /api/experiments/{experiment_id}/gm/revise` to revise the full upcoming draft from free-text feedback.
4. Optional: `POST /api/experiments/{experiment_id}/gm/approve` to approve or replace that plan.
5. In manual mode (`auto_approve=false`), approval is required before stepping.
6. `POST /api/experiments/{experiment_id}/step` to advance one round.
7. `GET /api/experiments/{experiment_id}` to refresh the full snapshot, or query logs and analytics endpoints as needed.
8. Connect to `WS /api/experiments/{experiment_id}/ws` for live updates while rounds run.

## REST Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness check for local dev and infrastructure probes |
| `GET` | `/api/runtime/llm-mode` | Read the process-local live/mock text generation mode |
| `PUT` | `/api/runtime/llm-mode` | Toggle the backend between live LLM calls and mock text generation |
| `POST` | `/api/experiments` | Create a new experiment with agent and arc configuration |
| `GET` | `/api/experiments/{experiment_id}` | Retrieve the current experiment snapshot |
| `POST` | `/api/experiments/{experiment_id}/start` | Mark an experiment as running without stepping a round |
| `POST` | `/api/experiments/{experiment_id}/pause` | Pause an active experiment |
| `POST` | `/api/experiments/{experiment_id}/step` | Start a round in the background; results stream via WebSocket |
| `POST` | `/api/experiments/{experiment_id}/inject` | Inject an Observer event into the simulation |
| `GET` | `/api/experiments/{experiment_id}/gm/plan` | Get or generate the next GM plan |
| `POST` | `/api/experiments/{experiment_id}/gm/revise` | Revise the pending GM plan from free-text feedback |
| `POST` | `/api/experiments/{experiment_id}/gm/approve` | Approve or replace the pending GM plan |
| `PUT` | `/api/experiments/{experiment_id}/arc` | Replace the active narrative arc |
| `GET` | `/api/experiments/{experiment_id}/agents` | List all agents in the experiment |
| `GET` | `/api/experiments/{experiment_id}/agents/{agent_id}/dossier` | Inspect a single agent in detail |
| `GET` | `/api/experiments/{experiment_id}/log` | Paginate and filter the event log |
| `GET` | `/api/experiments/{experiment_id}/analytics/summary` | Aggregate snapshot of rounds, resources, factions, and cooperation |
| `GET` | `/api/experiments/{experiment_id}/analytics/rounds` | Round-level report data with cooperation, betrayal counts, and GM context |
| `GET` | `/api/experiments/{experiment_id}/analytics/goals` | Per-agent goal progress history and derived end-state outcomes |
| `GET` | `/api/experiments/{experiment_id}/analytics/betrayals` | Betrayal and sabotage timeline including exile events |
| `GET` | `/api/experiments/{experiment_id}/analytics/suspicion` | Suspicion heatmap and per-agent suspicion history |
| `GET` | `/api/experiments/{experiment_id}/analytics/relationships` | Relationship graph edges derived from agent memory |
| `GET` | `/api/experiments/{experiment_id}/analytics/factions` | Current faction state plus pressure and membership-change timeline |
| `GET` | `/api/experiments/{experiment_id}/analytics/gm` | GM narration and crisis timeline by round |
| `GET` | `/api/experiments/{experiment_id}/highlights` | Variety-aware highlight reel for a round or the full game |
| `GET` | `/api/experiments/{experiment_id}/replay` | Replay index with round summaries and highlights |
| `GET` | `/api/experiments/{experiment_id}/rounds/{round_number}/narration` | Round narration text and backend audio metadata |
| `GET` | `/api/experiments/{experiment_id}/rounds/{round_number}/narration/audio` | Stream round narration audio |
| `GET` | `/api/experiments/{experiment_id}/rounds/{round_number}/snapshot` | World snapshot and per-round events |
| `GET` | `/api/experiments/{experiment_id}/usage` | Aggregated LLM usage by role, model, agent, and round |
| `GET` | `/api/experiments/{experiment_id}/usage/traces` | Paginated prompt-level usage traces |

## Create Experiment Example

```bash
curl -X POST http://localhost:8000/api/experiments \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Frontend Integration Trial",
    "total_rounds": 12,
    "auto_approve": false,
    "preset_arc_id": "slow_burn",
    "agents": [
      {
        "name": "Mara",
        "character_id": "undertaker_01",
        "personality": {
          "axes": {
            "paranoia": 72,
            "empathy": 40,
            "dominance": 58,
            "impulsiveness": 61,
            "loyalty": 44,
            "ambition": 70
          },
          "trait_tags": ["guarded", "curious", "scheming"],
          "self_concept": "I am the only one asking the right questions."
        },
        "goal": {
          "archetype": "truth_revelation",
          "text": "Figure out who is watching and force them to answer.",
          "progress_signals": ["observer clues"]
        }
      }
    ]
  }'
```

Selected response fields:

- `world_state`: current resources, threat, round number, and location occupancy
- `agents`: full agent state including memory, relationships, faction assignment, influence, and terminal metadata like `death_round`/`death_cause`
- `gm_plan`: current plan record for the upcoming or most recently applied round
- `factions`: current alliance/cult state
- `exile_history`: prior exile outcomes
- `sacrifice_history`: prior ritual self-sacrifice outcomes

## Runtime LLM Mode

The backend exposes a process-local toggle for frontend debugging and no-provider-key runs.

- `live` mode uses the normal GM, agent, and memory LLM paths.
- `mock` mode avoids external LLM calls and swaps in rule-based GM narration plus seeded mock agent thoughts/actions.
- the toggle is not persisted; it resets when the backend process restarts.
- existing stored experiment state is not rewritten when the mode changes.

Read the current mode:

```bash
curl http://localhost:8000/api/runtime/llm-mode
```

Example response:

```json
{
  "mode": "mock",
  "llm_calls_enabled": false
}
```

Switch into mock mode:

```bash
curl -X PUT http://localhost:8000/api/runtime/llm-mode \
  -H 'Content-Type: application/json' \
  -d '{
    "mode": "mock"
  }'
```

## GM Plan Flow

`GET /api/experiments/{experiment_id}/gm/plan` returns the cached plan for `current_round + 1` when available, otherwise it generates a fresh pending plan.

Revise the cached draft from free-text feedback:

```bash
curl -X POST http://localhost:8000/api/experiments/$EXPERIMENT_ID/gm/revise \
  -H 'Content-Type: application/json' \
  -d '{
    "feedback": "make it darker and add an earthquake"
  }'
```

Rules for `feedback`:

- leading and trailing whitespace is trimmed
- blank or whitespace-only feedback is rejected with `422`
- feedback longer than 500 characters is rejected with `422`
- already-applied GM plans cannot be revised; `POST /gm/revise` returns `409` for that state conflict

Each generated or revised pending draft can be previewed through:

- `GET /api/experiments/{experiment_id}/rounds/{round_number}/narration`
- `GET /api/experiments/{experiment_id}/rounds/{round_number}/narration/audio`

Approve the cached plan as-is:

```bash
curl -X POST http://localhost:8000/api/experiments/$EXPERIMENT_ID/gm/approve \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Approve with a replacement payload:

```bash
curl -X POST http://localhost:8000/api/experiments/$EXPERIMENT_ID/gm/approve \
  -H 'Content-Type: application/json' \
  -d '{
    "modified_plan": {
      "round": 1,
      "round_theme": "The ration ledger goes missing",
      "reasoning": "Start with a scarcity mystery that pressures cooperation.",
      "crisis_event": {
        "type": "resource",
        "description": "The town discovers that part of the food stockpile is gone.",
        "affects": ["food"],
        "severity": "medium"
      },
      "resource_modifiers": {
        "food": -2.0,
        "water": 0.0,
        "materials": 0.0,
        "power": 0.0
      },
      "environmental": "Cold rain keeps everyone close to shelter.",
      "narration": "By dawn, every cupboard feels lighter than it should.",
      "meta_hint": "Someone is hiding more than food."
    }
  }'
```

Current behavior to be aware of:

- `step` will still proceed even if you never called the approval endpoint.
- If you manually approved or modified the upcoming plan before `step`, that applied plan is reused for the round.

## Round Stepping

`POST /api/experiments/{experiment_id}/step` returns immediately with:

- `status`: `"step_started"`
- `round_number`: the upcoming round number
- `experiment_id`: the experiment ID

The round executes as a background task. Progress streams over WebSocket as `phase_change`, `agent_action`, and `round_end` messages. If the round fails, a `step_error` message is broadcast. Returns `409` if a round is already in progress.

**Important:** A REST-only caller (no WebSocket connection) will not receive error or completion notifications. Always connect a WebSocket before stepping.

Useful follow-up reads after a round completes:

- `GET /api/experiments/{id}/log?round_number=N`
- `GET /api/experiments/{id}/rounds/{N}/snapshot`
- `GET /api/experiments/{id}/highlights?scope=round&round=N`
  - returns the end-of-round reel for one completed round
  - up to 5 highlights, scored and ordered by dramatic significance
  - categories currently include `betrayal`, `crisis`, `resource_swing`, `alliance_shift`, `close_vote`, and `suspicion_spike`
- `GET /api/experiments/{id}/highlights?scope=game`
  - returns the cross-game reel
  - up to 12 highlights, ranked from the persisted log and round summaries
  - selection prefers category variety before filling the remaining slots by score
- `GET /api/experiments/{id}/usage?round_number=N`

## Event Log Filters

`GET /api/experiments/{experiment_id}/log` accepts:

- `limit`: page size, `1..200`
- `offset`: pagination offset, `>= 0`
- `phase`: isolate a phase like `dawn`, `midday`, or `night`
- `event_type`: narrow to a concrete event type
- `agent_id`: isolate one agent's activity
- `round_number`: inspect a single round, `>= 1`

Common event types:

- `experiment_created`
- `experiment_started`
- `experiment_paused`
- `observer_event`
- `gm_plan_generated`
- `gm_plan_feedback`
- `gm_plan_revised`
- `gm_plan_approved`
- `dawn`
- `morning`
- `midday`
- `afternoon`
- `night`
- `faction_update`
- `cult_activity`
- `exile_vote`
- `exile_enacted`
- `experiment_end`

## Analytics, Replay, And Usage

`GET /api/experiments/{experiment_id}/analytics/summary` returns a high-level operational view of the run:

- completed rounds
- active vs exiled agents
- faction and cult counts
- current resources and threat
- a derived cooperation score
- the dominant faction, when one exists

Additional report-grade analytics endpoints expose persisted derived views for frontend reports and dashboards:

- `GET /api/experiments/{experiment_id}/analytics/rounds`
  - one round-level item per completed round
  - GM theme, narration, and crisis payload
  - resolved cooperation score, betrayal count (includes sabotage), sabotage count (subset of betrayal)
  - `sabotage_count` is a subset of the broader `betrayal_count`
  - round resources, threat, and dominant faction
- `GET /api/experiments/{experiment_id}/analytics/goals`
  - one item per agent
  - round-by-round goal progress snapshots
  - a derived final outcome: `achieved`, `partial`, `failed`, or `unknown`
  - `status` is serialized from `AgentStatus`
- `GET /api/experiments/{experiment_id}/analytics/betrayals`
  - sabotage actions
  - hostile actions such as `accuse`, `attack`, `threaten`, `stab`, `shoot`, and `poison`
  - exile votes and enacted exiles
- `GET /api/experiments/{experiment_id}/analytics/suspicion`
  - flat heatmap points for charting
  - grouped per-agent suspicion histories
  - grouped history points include only `round_number` and `suspicion_level`
- `GET /api/experiments/{experiment_id}/analytics/factions`
  - current factions
  - faction pressure timeline
  - membership joins/leaves by round
  - timeline `kind` may be `null` for legacy logs that predate explicit faction-kind persistence
- `GET /api/experiments/{experiment_id}/analytics/gm`
  - round theme
  - narration
  - crisis payload
- `GET /api/experiments/{experiment_id}/highlights`
  - `scope=round` requires `round`
  - items include the ranked category, source `event_type`, optional `event_kind`, round, phase, score, summary, and contextual data
  - the hidden compatibility alias at `GET /api/experiments/{experiment_id}/analytics/highlights` now returns this normalized highlight schema too; it no longer returns raw event-type categories like `crisis_event`

`GET /api/experiments/{experiment_id}/replay` returns a replay-friendly index:

- one item per completed round with a summary, threat level, event count, cooperation score, sabotage count, betrayal count, and GM context
- the same game-scoped highlight feed used by the highlights endpoint

`GET /api/experiments/{experiment_id}/usage` and `.../usage/traces` expose LLM usage:

- grouped totals by role, model, agent, and round
- prompt-level traces with pagination and optional `round_number`, `agent_id`, and `role` filters
- `role` currently supports `gm`, `agent`, and `memory`
- `role=memory` isolates the dedicated memory-system traffic from decision-time agent prompts

## WebSocket Stream

Connect to `ws://localhost:8000/api/experiments/{experiment_id}/ws` for live updates.

Message envelope:

```json
{
  "type": "round_start",
  "round": 1,
  "phase": null,
  "timestamp": "2026-03-07T12:00:00Z",
  "data": {}
}
```

Connection semantics:

- the server sends a `connected` message immediately after the socket is accepted
- the server broadcasts round events only after a round is stepped
- the socket does not currently accept command messages; use REST for control actions
- reconnecting clients should fetch a fresh REST snapshot to resync local state

### Message Types

| Type | `data` payload |
|------|----------------|
| `connected` | `{ "experiment_id": "<id>" }` |
| `round_start` | `{ "theme": "<round theme>" }` |
| `gm_plan` | Full `GMPlanRecord` payload |
| `gm_audio_status` | `{ "status": "pending|ready|error", "audio_url"?, "error"? }` |
| `crisis_event` | Crisis event payload with `type`, `description`, `affects`, `severity` |
| `phase_change` | `{ "events": [<RoundEvent>, ...] }` for the phase |
| `agent_action` | `{ "agent_id", "agent_name", "action", "inner_thought"?, "speech_text"?, "speech_source"?, "dialogue"?, "cooperation_intent"?, "goal_progress"?, "is_consequence", "source_agent_id"?, "source_agent_name"?, "source_action_type"? }` and the message envelope also carries `is_consequence` |
Use `speech_text` as the canonical narrated line for turn presentation; `inner_thought` is preserved as the raw decision field for compatibility and diagnostics.
| `agent_move` | `{ "agent_id", "location" }` |
| `agent_speak` | Action-turn narration currently uses `{ "kind", "agent_id", "agent_name", "message", "target", "source" }` with `source="inner_thought"`. Social conversation events also include their richer conversation fields such as `speaker_id`, `speaker_name`, `listener_id`, `listener_name`, `tone`, `location`, and `trust_delta`, and set `source="dialogue"`. |
| `meeting_start` | `{ "kind", "proposal" }` |
| `meeting_speech` | `{ "kind", "agent_id", "agent_name", "stance", "content" }` |
| `meeting_vote` | `{ "kind", "agent_id", "agent_name", "vote" }` |
| `meeting_result` | Full meeting outcome payload plus `kind` |
| `resource_update` | Current resource snapshot, usually `{ "food", "water", "materials", "power" }` |
| `threat_update` | `{ "threat_level": <number> }` |
| `observer_event` | `{ "description": "<observer event text>" }` |
| `round_end` | `{ "status", "current_round", "total_rounds", "threat_level", "resources", "agents" }` |
| `experiment_end` | `{ "status": "<completed|collapsed>", "total_rounds": <number> }` |
| `step_error` | `{ "error": "<message>" }` — sent when a background round fails |

`round_end` is the final synchronization payload for the round. Clients should treat it as the
authoritative end-of-round state snapshot for experiment status, resources, threat, and agent
locations/status.

`phase_change` is the most complete event feed. Its embedded `RoundEvent.data.kind` values currently include conversation, meeting, exile, and faction-specific records such as:

- `agent_speak`
- `conversation_summary`
- `meeting_start`
- `meeting_speech`
- `meeting_vote`
- `meeting_result`
- `exile_vote`
- `exile_enacted`
- `faction_update`
- `cult_activity`

Analytics persistence notes:

- persisted `agent_action` log rows now store both `requested_action_type` and `resolved_action_type`
- consequence `agent_action` rows set `is_consequence: true` and identify the triggering action via `source_action_type`
- persisted `round_end` log rows now include compact round-summary payloads for goals, suspicion, factions, and GM context
- cooperation analytics use resolved outcomes, not only requested action intent

## Error Semantics

- Unknown experiments return `404 Experiment not found`.
- Unknown agents return `404 Agent not found`.
- Unknown rounds return `404 Round not found`.
- Missing round snapshots return `404 Round snapshot not found`.
- In manual mode, stepping without a generated and applied upcoming GM plan returns `409 Generate and approve the upcoming GM plan before stepping when auto_approve is false.`.
- Round narration that has not been generated, revised, or persisted yet returns `409 Narration is not available for this round yet.`.
- Revising an already-applied GM plan returns `409 Applied GM plans cannot be revised. Generate the next upcoming plan instead.`.
- GM revision failures return `502 GM plan revision failed.`.
- Unconfigured ElevenLabs audio returns `503 Narration audio is not configured.`.
- Invalid query/body payloads return FastAPI `422 Unprocessable Entity` responses.

## Notes

- The OpenAPI schema is the source of truth for request and response validation.
- Use REST for snapshots, control actions, analytics, replay, and usage queries.
- Use the WebSocket stream for live UI updates after a round has been stepped.
