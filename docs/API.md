# API Guide

This project exposes a FastAPI backend for simulation control and a WebSocket stream for live round events.

## Base URLs

- Backend API base path: `http://localhost:8000/api`
- Interactive Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI schema: `http://localhost:8000/openapi.json`

## Core workflow

1. `POST /api/experiments` to create a new experiment.
2. `GET /api/experiments/{experiment_id}/gm/plan` to inspect the next GM plan.
3. `POST /api/experiments/{experiment_id}/gm/approve` to approve or modify that plan.
4. `POST /api/experiments/{experiment_id}/step` to advance a single round.
5. `GET /api/experiments/{experiment_id}` or `GET /api/experiments/{experiment_id}/log` to refresh UI state.
6. Connect to `WS /api/experiments/{experiment_id}/ws` to receive live updates while rounds run.

## REST endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness check for local dev and infrastructure probes |
| `POST` | `/api/experiments` | Create a new experiment with agent and arc configuration |
| `GET` | `/api/experiments/{experiment_id}` | Retrieve the current experiment snapshot |
| `POST` | `/api/experiments/{experiment_id}/start` | Mark an experiment as running |
| `POST` | `/api/experiments/{experiment_id}/pause` | Pause an active experiment |
| `POST` | `/api/experiments/{experiment_id}/step` | Run one round and return round output plus state |
| `POST` | `/api/experiments/{experiment_id}/inject` | Inject an Observer event into the simulation |
| `GET` | `/api/experiments/{experiment_id}/gm/plan` | Get or generate the next GM plan |
| `POST` | `/api/experiments/{experiment_id}/gm/approve` | Approve or replace the pending GM plan |
| `PUT` | `/api/experiments/{experiment_id}/arc` | Replace the current narrative arc |
| `GET` | `/api/experiments/{experiment_id}/agents` | List all agents in the experiment |
| `GET` | `/api/experiments/{experiment_id}/agents/{agent_id}/dossier` | Inspect a single agent in detail |
| `GET` | `/api/experiments/{experiment_id}/log` | Paginate and filter the event log |

## Create experiment example

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

## Event log filters

`GET /api/experiments/{experiment_id}/log` accepts:

- `limit` and `offset` for pagination
- `phase` to isolate round phases like `dawn` or `night`
- `event_type` to narrow to a specific event type
- `agent_id` to isolate one agent's activity
- `round_number` to inspect a single round

## WebSocket stream

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

Common message types include:

- `connected`
- `round_start`
- `gm_plan`
- `agent_action`
- `agent_move`
- `crisis_event`
- `resource_update`
- `threat_update`
- `round_end`
- `observer_event`
- `experiment_end`

## Notes

- Experiment state is persisted through the backend store boundary, with Postgres as the durable path in deployed environments.
- The OpenAPI schema is the source of truth for request and response payloads.
- Frontend integrations should prefer the WebSocket stream for live round updates and REST endpoints for snapshots, control actions, and history queries.
