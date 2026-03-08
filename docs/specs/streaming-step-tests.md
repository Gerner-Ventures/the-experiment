---
title: "Streaming step test coverage"
status: todo
issue: 90
priority: P1
tags: [backend, testing, runtime]
---

# Streaming Step Test Coverage

## Problem

The streaming step execution path (`start_step`, `_step_streaming`, `_StreamingHook`) introduced in the e2e-game-loop PR has no dedicated test coverage. This is ~150 lines of new code handling background task execution, WS broadcasting, error recovery, and concurrency guards — all untested.

## Tests to Add

### 1. Step concurrency guard (409 response)

Test that calling `POST /step` while a round is already in progress for the same experiment returns 409. Verify:
- First step starts successfully
- Second step on same experiment returns 409
- Step on a different experiment is allowed
- After first step completes, the same experiment can step again

### 2. `_step_streaming` error path

Test that when `engine.run_round()` raises an exception:
- `step_error` WS message is broadcast with error details
- `_steps_in_progress` flag is cleared (experiment isn't permanently locked)
- `_current_tasks` entry is cleaned up
- Experiment state is not corrupted (partial writes are rolled back or not committed)

### 3. `_StreamingHook` WS broadcasts

Test the 4 hook methods broadcast the correct WS message types:
- `on_round_start` → broadcasts `round_start`
- `on_phase_start` → broadcasts `phase_change` with `status: "starting"`
- `on_phase_complete` → broadcasts `phase_change` with events + individual typed messages
- `on_agent_action` → broadcasts `agent_action` and optionally `agent_move`

### 4. `AgentBrain.decide()` LLM fallback

Test that when the LLM call raises an exception:
- A fallback `AgentDecision` with action type `observe` is returned
- The warning is logged with `exc_info=True`
- The fallback decision has the expected shape (inner_thought, cooperation_intent, etc.)

## Acceptance Criteria

- [x] All 4 test areas have at least one test each
<!-- canon:realized-in:PR#124 file:backend/tests/test_api_layer.py -->
<!-- canon:realized-in:PR#124 file:backend/tests/test_runtime.py -->
<!-- canon:realized-in:PR#124 file:backend/tests/test_agent_system.py -->
- [x] Tests use mocked LLM/engine to avoid real API calls
- [x] Tests verify WS message shapes match frontend TypeScript types
- [ ] CI passes with new tests
