---
title: "Consequence Action Types"
status: draft
issue: 110
priority: P1
tags: [stream-2, backend, engine, actions, consequences, animation]
depends_on: [sprite-action-visualization, hd-sprite-system]
---

# Consequence Action Types

New reactive action types that represent the consequences of another agent's action. When Agent 1 shoots Agent 2, the engine should automatically generate a consequence: Agent 2 is bleeding. These are not agent decisions — they are system-generated reactions resolved by the engine.

## 1. Background

Currently all 40 action types are agent-initiated decisions. There is no mechanism for the engine to generate reactive states when resolving aggressive or impactful actions. The result is that victims of violence appear unaffected — Agent 1 shoots Agent 2, but Agent 2 shows no visual response.

The engine's action resolution in `backend/app/engine/service.py` already processes actions sequentially. It needs to emit consequence actions as side effects of aggressive action resolution.

## 2. Requirements

### New Consequence Action Types (Backend)

- [ ] Add consequence action types to `ActionType` in `backend/app/agents/models.py`:
  - `bleeding` — result of stab, shoot, attack causing wound
  - `injured` — general injury state from physical actions
  - `stunned` — knocked senseless from attack or threat
  - `knocked_down` — physically knocked to ground
  - `burning` — on fire from arson/fire-related actions
  - `poisoned` — result of poison action
  - `crying` — emotional reaction to mourn, accuse, or threat
  - `fleeing` — panic response to aggressive actions
- [x] Mark consequence types as non-decisional (agents cannot choose these — engine generates them)
<!-- canon:realized-in:PR#157 file:backend/app/actions/models.py -->
<!-- canon:realized-in:PR#157 file:backend/app/actions/catalog.py -->
- [x] Update `ACTION_TYPES` tuple and `DecisionActionType` to distinguish decisions from consequences
<!-- canon:realized-in:PR#157 file:backend/app/agents/models.py -->
<!-- canon:realized-in:PR#157 file:backend/app/schemas/agent_decision.py -->
- [x] Action catalog provides `DECISION_ACTION_IDS` and `CONSEQUENCE_ACTION_IDS` partitions
- [ ] Update `shared/schemas/agent_decision.json` with new enum values and a `consequence_types` subset

### Engine Resolution (Backend)

- [ ] When resolving aggressive actions (attack, stab, shoot, threaten, poison), generate consequence action for target agent
- [ ] Consequence mapping table: which aggressive action produces which consequence(s)
  - `shoot` → `bleeding`, `injured`
  - `stab` → `bleeding`, `injured`
  - `attack` → `injured`, `knocked_down`, or `stunned` (variable)
  - `poison` → `poisoned`
  - `threaten` → `crying`, `fleeing`, or `stunned` (personality-dependent)
- [ ] Consequence actions broadcast via WebSocket as `agent_action` messages with a `is_consequence: true` flag
- [ ] Consequences enqueue in the turn system after the aggressor's turn

### Frontend Animation Support

> See `hd-sprite-system.md` Section 4 "Consequence Actions" for the full animation plan.
> The HD composable system defines distinct poses for all 8 consequence types.

- [ ] Add consequence animations to `ACTION_TO_ANIMATION` mapping in `frontend/src/types/sprite.ts`
- [ ] All 8 consequences get distinct visual poses in HD sprite system:
  - `bleeding` — injured lean + red drip pixels
  - `injured` — hunched/limping pose
  - `stunned` — swaying idle + dizzy stars circling head
  - `knocked_down` — on ground (twitching)
  - `burning` — panic stance + flame particles
  - `poisoned` — hunched + green particles
  - `crying` — head down + tear pixels
  - `fleeing` — fast walk + panic face
- [ ] Consequence actions render with distinct visual treatment (e.g., red flash, injury overlay)
- [ ] Bleeding/injured states persist visually beyond the single turn (status effect indicator)

### Schema Updates

- [x] `shared/schemas/agent_decision.json` — add consequence enum values (via backend/app/schemas/agent_decision.py)
- [ ] `shared/schemas/ws_message.json` — add `is_consequence` field to `agent_action` payload
- [ ] `frontend/src/types/agent-decision.ts` — sync with schema changes
- [ ] `backend/app/db/models.py` — consider adding `INJURED`, `POISONED` to `AgentStatus` enum

## 3. Design

### Consequence Resolution Flow

```
Agent 1 decides: shoot(target=Agent2)
  → Engine resolves action
  → Engine generates: Agent2.consequence(bleeding, injured)
  → WebSocket broadcasts:
    1. agent_action { agent: Agent1, action: shoot, target: Agent2 }
    2. agent_action { agent: Agent2, action: bleeding, is_consequence: true, caused_by: Agent1 }
  → Frontend turn queue:
    1. Agent1 plays shoot animation
    2. Agent2 plays bleeding animation (consequence)
```

### Key Files

| File | Changes |
|------|---------|
| `backend/app/agents/models.py` | Add consequence action types, separate from decision types |
| `backend/app/engine/service.py` | Consequence generation during action resolution |
| `backend/app/engine/models.py` | Consequence mapping table |
| `shared/schemas/agent_decision.json` | New enum values |
| `shared/schemas/ws_message.json` | `is_consequence` field |
| `frontend/src/types/sprite.ts` | Consequence animation mappings |
| `frontend/src/types/agent-decision.ts` | Sync ActionType |
| `frontend/src/config/character-sprites.ts` | Consequence animation frames |

## 4. Rollout Plan

1. **Phase 1:** Backend — define consequence types, add to models and schemas
2. **Phase 2:** Backend — engine generates consequences for `shoot`, `stab`, `attack`
3. **Phase 3:** Frontend — consequence animations and visual treatment
4. **Phase 4:** Expand to all aggressive/impactful actions with personality-dependent reactions
