# Standardize Observability Across PostHog, Langfuse & Structlog — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every observability event filterable by environment, experiment, round, agent, and phase — with identical field names across PostHog, Langfuse, and structlog.

**Architecture:** Bind canonical context fields via `structlog.contextvars` at round and agent scope. Add a `capture_with_context()` PostHog helper that auto-merges these fields. Pipe `settings.env` into all three systems as `environment`. Complete missing Langfuse scores (`total_cost_usd`, `llm_call_count`).

**Tech Stack:** Python, structlog, PostHog, Langfuse, litellm

---

### Task 1: Add `capture_with_context()` PostHog helper

**Files:**
- Modify: `backend/app/core/posthog.py`
- Create: `backend/tests/test_posthog.py`

**Step 1: Write the test**

```python
# backend/tests/test_posthog.py
from __future__ import annotations

import structlog

import app.core.posthog as ph


def test_capture_with_context_merges_structlog_contextvars(monkeypatch: pytest.MonkeyPatch) -> None:
    """capture_with_context merges canonical fields from structlog.contextvars."""
    captured: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(ph, "_client", type("M", (), {"capture": staticmethod(
        lambda distinct_id, event, properties: captured.append((event, properties))
    )})())

    structlog.contextvars.bind_contextvars(
        environment="test",
        experiment_id="exp-1",
        round_number=3,
        agent_id="a-1",
        agent_name="Chef",
    )
    try:
        ph.capture_with_context("test_event", {"custom_field": "value"})
    finally:
        structlog.contextvars.unbind_contextvars(
            "environment", "experiment_id", "round_number", "agent_id", "agent_name"
        )

    assert len(captured) == 1
    event_name, props = captured[0]
    assert event_name == "test_event"
    assert props["environment"] == "test"
    assert props["experiment_id"] == "exp-1"
    assert props["round_number"] == 3
    assert props["agent_id"] == "a-1"
    assert props["agent_name"] == "Chef"
    assert props["custom_field"] == "value"


def test_capture_with_context_omits_none_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """capture_with_context omits canonical fields that are None/unset."""
    captured: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(ph, "_client", type("M", (), {"capture": staticmethod(
        lambda distinct_id, event, properties: captured.append((event, properties))
    )})())

    # Only bind environment, not agent fields
    structlog.contextvars.bind_contextvars(environment="production", experiment_id="exp-2")
    try:
        ph.capture_with_context("test_event", {"foo": "bar"})
    finally:
        structlog.contextvars.unbind_contextvars("environment", "experiment_id")

    assert len(captured) == 1
    _, props = captured[0]
    assert props["environment"] == "production"
    assert props["experiment_id"] == "exp-2"
    assert "agent_id" not in props
    assert "agent_name" not in props


def test_capture_with_context_noop_when_no_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """capture_with_context is a no-op when PostHog client is not initialized."""
    monkeypatch.setattr(ph, "_client", None)
    # Should not raise
    ph.capture_with_context("test_event", {"foo": "bar"})
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_posthog.py -v`
Expected: FAIL — `capture_with_context` does not exist yet.

**Step 3: Implement `capture_with_context()`**

Add to `backend/app/core/posthog.py` after the existing `capture()` function:

```python
import structlog


def capture_with_context(event: str, properties: dict[str, object] | None = None) -> None:
    """Capture a PostHog event with canonical context from structlog.contextvars.

    Merges environment, experiment_id, round_number, agent_id, agent_name from
    the current structlog contextvar bindings into the event properties. Explicit
    properties override context values.
    """
    if _client is None:
        return
    ctx = structlog.contextvars.get_contextvars()
    merged = {
        "environment": ctx.get("environment"),
        "experiment_id": ctx.get("experiment_id"),
        "round_number": ctx.get("round_number"),
        "agent_id": ctx.get("agent_id"),
        "agent_name": ctx.get("agent_name"),
        **(properties or {}),
    }
    _client.capture(SYSTEM_ID, event, {k: v for k, v in merged.items() if v is not None})
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_posthog.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/core/posthog.py backend/tests/test_posthog.py
git commit -m "feat: add capture_with_context() PostHog helper

Merges canonical context fields (environment, experiment_id, round_number,
agent_id, agent_name) from structlog contextvars into PostHog event properties."
```

---

### Task 2: Bind structlog contextvars at round start with `environment`

**Files:**
- Modify: `backend/app/engine/service.py:117-131`
- Modify: `backend/app/api/runtime.py:432-488`

**Step 1: Bind canonical context in `SimulationEngine.run_round()`**

At the top of `run_round()` (after line 122 `state.world_state.round_number = round_number`), add:

```python
from app.core.config import get_settings

# Bind canonical context for all structlog events during this round
structlog.contextvars.bind_contextvars(
    environment=get_settings().env,
    experiment_id=state.experiment_id,
    round_number=round_number,
)
```

Remove the explicit `experiment_id` and `round_number` kwargs from the two `log.info()` calls in `run_round()` (lines 125-131 and 242-249) since they'll now come from contextvars automatically. Keep fields that are NOT in the canonical set (like `total_rounds`, `agent_count`, `status`, etc.).

**Step 2: Clean up contextvars at round end**

At the very end of `run_round()`, after the return statement's `RoundResult` is built (before `return`), unbind agent-scoped fields to prevent leakage:

```python
structlog.contextvars.unbind_contextvars("agent_id", "agent_name")
```

Note: Don't unbind `environment`/`experiment_id`/`round_number` — they stay for the runtime's PostHog events after the round.

**Step 3: Update runtime PostHog events to use `capture_with_context()`**

In `backend/app/api/runtime.py`, replace the `ph.capture()` calls at lines 463-472 (`round_completed`) and 481-488 (`experiment_finished`) with `ph.capture_with_context()`, removing the `experiment_id` field from properties (it comes from context now):

```python
# round_completed (line 463)
ph.capture_with_context(
    "round_completed",
    {
        "total_rounds": state.total_rounds,
        "threat_level": round_result.threat_level,
        "duration_seconds": round(round_duration, 2),
    },
)

# experiment_finished (line 481)
ph.capture_with_context(
    "experiment_finished",
    {
        "status": state.status,
        "total_rounds": state.total_rounds,
    },
)
```

Also update `experiment_started` at line 436 and `experiment_created` at line 239:

```python
# experiment_started (line 436)
ph.capture_with_context(
    "experiment_started",
    {
        "agent_count": len(state.agents),
        "total_rounds": state.total_rounds,
    },
)
```

For `experiment_created` at line 239, the context may not be bound yet (it's before `run_round`). Bind `environment` before capturing:

```python
structlog.contextvars.bind_contextvars(environment=get_settings().env)
ph.capture_with_context(
    "experiment_created",
    {
        "experiment_id": experiment_id,  # Keep explicit — not in context yet
        "name": request.name,
        "agent_count": len(agents),
        "total_rounds": request.total_rounds,
        "preset_arc_id": request.preset_arc_id,
    },
)
```

**Step 4: Run existing tests**

Run: `cd backend && .venv/bin/python -m pytest tests/ -v --timeout=30`
Expected: All pass.

**Step 5: Commit**

```bash
git add backend/app/engine/service.py backend/app/api/runtime.py
git commit -m "feat: bind canonical structlog context at round start

Binds environment, experiment_id, round_number via structlog.contextvars
at the start of each round. Migrates runtime PostHog events to use
capture_with_context() for automatic field inclusion."
```

---

### Task 3: Add agent-scoped context binding and PostHog `agent_decision` event

**Files:**
- Modify: `backend/app/agents/brain.py:64-113`
- Modify: `backend/app/engine/service.py` (the `_action_phase` method)

**Step 1: Find where agents are iterated**

In `service.py`, find the `_action_phase` method where agent decisions are made. The agent brain's `decide()` is called through `AgentService`. We need to bind `agent_id`/`agent_name` before each agent's turn and capture a PostHog event after.

**Step 2: Bind agent context and capture PostHog event in `AgentBrain.decide()`**

In `backend/app/agents/brain.py`, add structlog and PostHog imports:

```python
import structlog
from app.core import posthog as ph
```

At the start of `decide()`, bind agent context:

```python
async def decide(self, context: AgentContext) -> AgentTurnResult:
    structlog.contextvars.bind_contextvars(
        agent_id=context.agent_id,
        agent_name=context.name,
    )
    prompt = build_agent_prompt(context)
    # ... existing try/except ...
```

After the decision is made (whether from LLM or fallback), before returning, capture the PostHog event:

```python
    # After decision is resolved (after the try/except, around line 113)
    ph.capture_with_context(
        "agent_decision",
        {
            "action_type": decision.action.type,
            "cooperation_intent": decision.cooperation_intent,
            "phase": context.world_state.phase if hasattr(context.world_state, "phase") else None,
        },
    )
```

For the fallback path, capture a separate event:

```python
    except Exception:
        logger.warning(
            "LLM decision failed for agent %s (%s), using fallback observe action",
            context.name,
            context.agent_id,
            exc_info=True,
        )
        ph.capture_with_context(
            "agent_decision_fallback",
            {
                "error_type": "llm_parse_failure",
            },
        )
        decision = AgentDecision(...)
```

**Step 3: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/ -v --timeout=30`
Expected: All pass.

**Step 4: Commit**

```bash
git add backend/app/agents/brain.py
git commit -m "feat: add agent_decision and agent_decision_fallback PostHog events

Binds agent_id and agent_name to structlog contextvars before each agent
decision. Captures agent_decision event with action_type and cooperation_intent,
and agent_decision_fallback when LLM call fails."
```

---

### Task 4: Add Langfuse scores for `total_cost_usd` and `llm_call_count`

**Files:**
- Modify: `backend/app/engine/service.py:274-283`
- Modify: `backend/app/api/runtime.py:432-489`

The engine doesn't have access to LLM trackers, but the runtime does (via `_llm_trackers()`). The cleanest approach is to compute and record the scores in `_run_round_locked()` after `run_round()` returns.

**Step 1: Add score recording in `_run_round_locked()`**

In `backend/app/api/runtime.py`, after the `round_completed` PostHog capture (around line 472), add:

```python
# Record LLM cost and call count as Langfuse scores
self._record_round_llm_scores(experiment_id, round_result.round_number)
```

Add the helper method to `ExperimentRuntime`:

```python
def _record_round_llm_scores(self, experiment_id: str, round_number: int) -> None:
    """Record total_cost_usd and llm_call_count as Langfuse scores for the round."""
    total_cost = 0.0
    call_count = 0
    for tracker in self._llm_trackers():
        for record in tracker.list_records(
            experiment_id=experiment_id, round_number=round_number
        ):
            total_cost += record.usage.cost_usd
            call_count += 1

    if call_count == 0:
        return

    # Find the trace_id from langfuse context (set during run_round)
    from app.core import langfuse as lf

    ctx = lf.get_trace_context()
    trace_id = ctx.get("trace_id")
    if trace_id:
        lf.record_scores(
            trace_id=trace_id,
            scores={
                "total_cost_usd": round(total_cost, 6),
                "llm_call_count": float(call_count),
            },
        )
```

Also capture as a PostHog event:

```python
    ph.capture_with_context(
        "round_llm_cost",
        {
            "total_cost_usd": round(total_cost, 6),
            "call_count": call_count,
        },
    )
```

**Step 2: Remove the TODO comment in `engine/service.py`**

In `service.py` line 281, remove or update the TODO comment:

```python
# Before:
# TODO: add total_cost_usd and llm_call_count scores (spec Req 5)

# After: (remove the comment entirely)
```

**Step 3: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/ -v --timeout=30`
Expected: All pass.

**Step 4: Commit**

```bash
git add backend/app/engine/service.py backend/app/api/runtime.py
git commit -m "feat: record total_cost_usd and llm_call_count as Langfuse scores

Computes LLM cost and call count from usage trackers after each round
and records them as Langfuse scores. Also captures round_llm_cost PostHog event."
```

---

### Task 5: Migrate `llm_parse_failure` PostHog event to `capture_with_context()`

**Files:**
- Modify: `backend/app/llm/client.py:110-120`

**Step 1: Update the import**

In `client.py`, the existing import is `from app.core import posthog as ph`. Keep this but use `ph.capture_with_context()` instead of `ph.capture()`.

**Step 2: Replace `ph.capture()` with `ph.capture_with_context()`**

```python
# Before (line 110-120):
ph.capture(
    "llm_parse_failure",
    {
        "role": request.role,
        "model": result.model,
        "experiment_id": request.metadata.get("experiment_id"),
        "finish_reason": finish_reason,
        "completion_tokens": result.usage.completion_tokens,
        "max_tokens_requested": request.max_tokens,
    },
)

# After:
ph.capture_with_context(
    "llm_parse_failure",
    {
        "role": request.role,
        "model": result.model,
        "finish_reason": finish_reason,
        "completion_tokens": result.usage.completion_tokens,
        "max_tokens_requested": request.max_tokens,
    },
)
```

Note: `experiment_id` is removed from explicit properties — it now comes from structlog contextvars via `capture_with_context()`.

**Step 3: Update test assertion**

In `backend/tests/test_llm_integration.py`, the test `test_structured_generation_raises_after_retry_exhausted` monkeypatches `app.llm.client.ph.capture`. Update it to monkeypatch `app.llm.client.ph.capture_with_context` instead:

```python
monkeypatch.setattr(
    "app.llm.client.ph.capture_with_context",
    lambda event, properties: captured_events.append((event, properties)),
)
```

Also update `test_structured_generation_retries_on_parse_failure` similarly.

**Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_llm_integration.py -v`
Expected: All pass.

**Step 5: Commit**

```bash
git add backend/app/llm/client.py backend/tests/test_llm_integration.py
git commit -m "refactor: migrate llm_parse_failure to capture_with_context

Uses the new PostHog helper to automatically include environment and
canonical context fields in the llm_parse_failure event."
```

---

### Task 6: Add `environment` to Langfuse trace metadata

**Files:**
- Modify: `backend/app/engine/service.py:133-153`
- Modify: `backend/app/llm/client.py:135-157`

**Step 1: Add `environment` to round trace metadata**

In `service.py`, the `lf.trace()` call at line 133 creates the round trace. Add `environment` to its metadata:

```python
trace = lf.trace(
    name=f"round-{round_number}",
    session_id=state.experiment_id or None,
    input={...},
    tags=[
        f"arc:{state.arc.name}",
        f"env:{get_settings().env}",  # Add environment tag
    ],
    metadata={
        "environment": get_settings().env,  # Add to metadata
        "experiment_id": state.experiment_id,
        "round_number": round_number,
        "total_rounds": state.total_rounds,
        "status": state.status,
    },
)
```

**Step 2: Add `environment` to LLM generation metadata**

In `client.py`, the `_build_metadata()` method constructs metadata for Langfuse generations. Add `environment`:

```python
def _build_metadata(self, request: LLMRequest, ...) -> dict[str, Any]:
    metadata = {
        **request.metadata,
        **get_trace_context(),
        "generation_name": generation_name_override or request.generation_name or request.role,
        "session_id": request.metadata.get("experiment_id") or None,
        "trace_user_id": request.metadata.get("agent_name", request.role),
        "environment": self.settings.env,  # Add environment
    }
    ...
```

**Step 3: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/ -v --timeout=30`
Expected: All pass.

**Step 4: Commit**

```bash
git add backend/app/engine/service.py backend/app/llm/client.py
git commit -m "feat: add environment to Langfuse trace metadata and tags

Includes settings.env in round trace metadata/tags and LLM generation
metadata so Langfuse traces are filterable by environment."
```

---

### Task 7: Validate end-to-end

**Step 1: Run full test suite**

Run: `cd backend && .venv/bin/python -m pytest tests/ -v --timeout=60`
Expected: All pass.

**Step 2: Run type check**

Run: `cd backend && .venv/bin/python -m mypy app/ --ignore-missing-imports`
Expected: No errors.

**Step 3: Update spec status**

In `docs/specs/improve-langfuse-observability.md`:
- Check off completed ACs in Requirements 2 (canonical fields), 3 (PostHog events), 4 (Langfuse scores), 5 (structlog)
- Leave Requirement 1 (trace hierarchy) unchecked — that's a separate investigation

**Step 4: Commit spec update**

```bash
git add docs/specs/improve-langfuse-observability.md
git commit -m "docs: update observability spec with completed ACs"
```
