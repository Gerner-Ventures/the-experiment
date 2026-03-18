---
title: "Agent ECS State Bridge"
type: spec
status: todo
issue: 206
owner: ""
team: "frontend, backend"
review_status: draft
tags: [stream-1, stream-2, frontend, backend, ecs, websocket, agents]
depends_on: [bitecs-entity-component-system]
created: "2026-03-16"
updated: "2026-03-16"
---

# Agent ECS State Bridge

## 1. Background
<!-- canon:system:1 status:done -->

The ECS foundation (PR #201) defined stub components for agent state — Mood, Social, Inventory, TaskAssignment — but they are not wired to any data source. This spec covers wiring these stubs to actual backend agent state via new WebSocket message types.

This is distinct from the GM crisis → fire/weather bridge, which is already specced in `ecs-fire-hazards-integration.md` Section 6.3 and uses the existing `crisis_event` message type. This spec requires new WS message types that don't exist in `shared/schemas/ws_message.json`.

**Blocked on:** Backend Stream 2 being active (S2.4 Agent System, S2.8 WebSocket Layer).

## 2. New WebSocket Message Types
<!-- canon:system:2 status:todo -->

Three new message types to add to `shared/schemas/ws_message.json`:

### `agent_mood_update`
```json
{
  "type": "agent_mood_update",
  "data": {
    "agent_id": "string",
    "happiness": 0.0,
    "fear": 0.0,
    "anger": 0.0
  }
}
```
**Emitted:** After night-phase reflections, when an agent's mood changes based on inner monologue LLM output.

### `agent_status_update`
```json
{
  "type": "agent_status_update",
  "data": {
    "agent_id": "string",
    "influence": 0.0,
    "suspicion": 0.0
  }
}
```
**Emitted:** After suspicion-changing actions (edge-of-map exploration, failed actions, Observer Events, other agents' accusations).

### `agent_inventory_delta`
```json
{
  "type": "agent_inventory_delta",
  "data": {
    "agent_id": "string",
    "item_count": 0,
    "delta": 0,
    "action": "gather | trade | hoard | use"
  }
}
```
**Emitted:** After resource actions (gather, trade, hoard) resolve in the afternoon action phase.

## 3. Schema Additions
<!-- canon:system:3 status:todo -->

Extend the `type` enum in `shared/schemas/ws_message.json` to include:
- `agent_mood_update`
- `agent_status_update`
- `agent_inventory_delta`

Both frontend and backend generate types from this shared schema, so the enum extension propagates to both.

## 4. Backend Emission Points
<!-- canon:system:4 status:todo -->

| Message | Lifecycle Point | Backend Module |
|---------|----------------|----------------|
| `agent_mood_update` | Night phase → after agent reflection LLM call | S2.5 round orchestrator, night phase |
| `agent_status_update` | After any suspicion-changing event resolves | S2.4 suspicion system |
| `agent_inventory_delta` | Afternoon phase → after resource action resolves | S2.5 round orchestrator, afternoon phase |

Each emission broadcasts to all connected WebSocket clients for the experiment.

## 5. Frontend Routing
<!-- canon:system:5 status:todo -->

```
WebSocket message
  → wsRouter (frontend/src/composables/useWebSocket.ts)
    → Pinia store action (agentStore.updateMood / updateStatus / updateInventory)
      → GameSession method (session.syncAgentMood / syncAgentStatus / syncAgentInventory)
        → ECS component write (Mood[eid], Social[eid], Inventory[eid])
```

### Pinia Store Actions
The agent store (`frontend/src/stores/agent.ts`) receives the WS message and updates its own state (authoritative source). Then calls the GameSession method to sync the ECS representation.

### GameSession Methods
```typescript
syncAgentMood(agentId: string, happiness: number, fear: number, anger: number): void
syncAgentStatus(agentId: string, influence: number, suspicion: number): void
syncAgentInventory(agentId: string, itemCount: number): void
```

Each method looks up the entity ID from the agent ID mapping and writes to the corresponding ECS component fields.

## 6. Visual Effects
<!-- canon:system:6 status:todo -->

ECS systems read the stub component values and apply visual effects during renderSync:

| Component Field | Visual Effect | Implementation |
|----------------|---------------|----------------|
| Mood.happiness | Sprite tint (warm/cool) | High happiness → warm tint, low → cool/grey tint |
| Mood.fear | Movement speed modifier | High fear → faster, erratic movement |
| Social.suspicion | Glow intensity | Suspicion > threshold → red glow ring around sprite |
| Inventory.itemCount | Badge overlay | Small number badge on sprite corner |

These effects are additive — they layer on top of existing animation and rendering without replacing it.

## 7. Dual-Truth Rules
<!-- canon:system:7 status:todo -->

Pinia stores remain the authoritative source of agent state. ECS components are write-only mirrors used exclusively for rendering:

- **Pinia → ECS:** One-way data flow. Pinia store actions write to ECS components. ECS systems never write back to Pinia.
- **round_end sync:** At the end of each round, a full sync pass writes all agent state from Pinia to ECS, correcting any drift from missed incremental updates.
- **No ECS reads for game logic:** Game logic (conversations, votes, GM decisions) reads from Pinia stores, never from ECS components.

### Acceptance Criteria

- [ ] 3 new message types added to `shared/schemas/ws_message.json` enum
- [ ] Backend emits each message at the correct lifecycle point
- [ ] Frontend wsRouter routes each message to the correct Pinia store action
- [ ] GameSession methods write mood/status/inventory values to ECS components
- [ ] At least one visual effect wired end-to-end (e.g., mood → sprite tint)
- [ ] round_end correctly syncs both Pinia and ECS state
