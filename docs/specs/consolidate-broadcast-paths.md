---
title: "Consolidate WS broadcast paths (broadcast_round → RoundHook)"
status: todo
priority: P2
review_status: approved
tags: [stream-2, backend, refactor]
---

# Consolidate WS Broadcast Paths

## Problem

There are two code paths that broadcast WebSocket messages during a round:

1. **`broadcast_round()`** — Legacy path used by the synchronous `step()` method. Broadcasts all events after the round completes in one batch. ~80 lines of if/elif/broadcast logic.
2. **`_StreamingHook`** — New path used by `start_step()` / `_step_streaming()`. Broadcasts events live as each phase completes via the `RoundHook` callback interface.

Both paths use the shared `_EVENT_KIND_TO_WS_TYPE` mapping, but they produce different WS message sequences for the same logical round:
- `broadcast_round` emits `agent_move`, `resource_update`, and `threat_update` as separate messages
- `_StreamingHook` does not emit these (relies on per-action `agent_action` broadcasts and the final `round_end` payload)

This duplication will drift as new event types or broadcast behaviors are added.

## Solution

Migrate the legacy `step()` method to use `run_round(state, hook=hook)` with a hook, eliminating `broadcast_round()` entirely.

### 1. Update `step()` to use `RoundHook`

```python
async def step(self, experiment_id: str) -> tuple[RoundResult, SimulationState]:
    async with self.lock:
        state = await self.get_state(experiment_id)
        if state.status == "setup":
            state.status = "running"
        if not state.auto_approve:
            record = await self.get_or_generate_gm_plan(experiment_id)
            approved = self.gm_service.approve_plan(record)
            state.gm_plan = self.gm_service.apply_plan(approved)
        hook = _StreamingHook(experiment_id=experiment_id, runtime=self)
        round_result = await self.engine.run_round(state, hook=hook)
        await self.store.save_state(state)
        await self.store.record_round_result(experiment_id, round_result)
        await self._log_round_result(experiment_id, round_result)
    # Broadcast round_end with full state
    await self._broadcast_round_end(experiment_id, round_result, state)
    return round_result, state
```

### 2. Delete `broadcast_round()`

Remove the ~120-line method entirely once `step()` uses the hook path.

### 3. Extract shared `round_end` broadcast

Both `_step_streaming` and the updated `step()` need to broadcast `round_end` with full state. Extract into a shared `_broadcast_round_end()` method.

## Acceptance Criteria

- [ ] `step()` uses `run_round(state, hook=hook)` — no direct engine method calls
- [ ] `broadcast_round()` is deleted
- [ ] `_broadcast_round_end()` is shared between `step()` and `_step_streaming()`
- [ ] WS message sequence is identical for both `step()` and `start_step()` paths
- [ ] All existing tests pass
- [x] Frontend receives same events regardless of which endpoint triggered the round
<!-- specwright:realized-in:PR#69 file:frontend/src/stores/experiment.ts -->

## Key Files

- `backend/app/api/runtime.py` — `ExperimentRuntime.step()`, `broadcast_round()`, `_step_streaming()`
