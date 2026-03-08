---
title: "Per-experiment runtime locks"
status: todo
issue: 89
priority: P1
tags: [backend, concurrency, runtime]
---

# Per-Experiment Runtime Locks

## Problem

`ExperimentRuntime` uses a single global `asyncio.Lock` (`self.lock`) shared across all experiments. When `_step_streaming` acquires the lock for a round (which includes multiple sequential LLM calls taking 10-45s each), ALL other API operations are blocked — including `get_state`, `create_experiment`, and `step` for unrelated experiments.

The per-experiment `_steps_in_progress` dict (added in PR #57) prevents concurrent steps on the same experiment, but the global lock still serializes all experiment operations.

## Solution

### 1. Per-experiment lock registry

Replace the single `self.lock` with a `dict[str, asyncio.Lock]` keyed by experiment ID. Each experiment gets its own lock, so operations on different experiments can proceed concurrently.

```python
class ExperimentRuntime:
    def __init__(self, ...):
        self._locks: dict[str, asyncio.Lock] = {}

    def _get_lock(self, experiment_id: str) -> asyncio.Lock:
        if experiment_id not in self._locks:
            self._locks[experiment_id] = asyncio.Lock()
        return self._locks[experiment_id]
```

### 2. Narrow lock scope in _step_streaming

Consider whether the lock needs to be held for the entire `run_round` call, or only for state read/write phases. The LLM calls themselves don't need mutual exclusion — only the state mutations do.

### 3. Lock cleanup

Clean up locks for experiments that are completed or deleted to prevent unbounded growth.

## Acceptance Criteria

- [ ] Operations on experiment A do not block operations on experiment B
- [ ] Concurrent steps on the same experiment are still properly serialized
- [ ] Lock registry is cleaned up when experiments complete or are deleted
- [ ] Existing tests continue to pass
