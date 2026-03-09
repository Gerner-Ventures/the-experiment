---
title: "Standardize Observability Across PostHog, Langfuse & Structlog"
status: in_progress
priority: high
tags: [stream-3, infra, observability, langfuse, tracing, posthog, logging]
depends_on: [s3.6-langfuse-tracing]
updated: "2026-03-08"
---

# Standardize Observability Across PostHog, Langfuse & Structlog

Standardize field names and event coverage across all three observability systems so that every event is filterable by environment, experiment, round, agent, and phase — and the same context propagates consistently regardless of where you look.

## Background

The project uses three observability systems:

1. **Structlog** — JSON-structured application logs, exported to PostHog via OpenTelemetry
2. **PostHog** — Product analytics events for experiment lifecycle tracking
3. **Langfuse** — LLM-specific tracing with trace/span hierarchy, generation metadata, and quality scores

Each system was built independently, resulting in:

- **Inconsistent field names** — `agent_name` vs `agent_id` vs `trace_user_id` depending on system
- **Incomplete context propagation** — some events carry `experiment_id` + `round_number` + `agent_id`, others carry only a subset
- **Sparse PostHog coverage** — only 8 event types, no agent-level or phase-level events
- **Broken Langfuse trace hierarchy** — LLM calls appear as orphaned `litellm-acompletion` traces instead of nesting under round traces (106/107 traces orphaned)
- **Missing Langfuse scores** — `total_cost_usd` and `llm_call_count` not yet recorded as round-level scores

### What's Already Working

Several items from the original spec have been implemented:

- **Descriptive generation names** — GM calls named `gm-plan`, agent calls `agent:{name}`, memory calls `memory:classify:{name}` etc.
- **Session/user IDs** — `session_id` (experiment_id) and `trace_user_id` (agent_name) propagated on all LLM calls
- **Langfuse scores** — `cooperation_ratio` and `threat_level` recorded via `record_scores()`
- **Trace I/O** — Round trace input (resources, threat, agent count) and output (status, cooperation, event count) recorded
- **Memory call metadata** — `experiment_id`, `agent_id`, `agent_name` passed through to all memory LLM calls
- **Tags** — Round traces tagged with `arc:{name}`, agent calls tagged with `role:agent` and `archetype:{type}`
- **Debug logging** — `langfuse_context` debug log emits `trace_id`, `parent_observation_id` before LLM calls

### What Remains

1. **Broken trace hierarchy** — The critical issue. LLM calls still appear orphaned.
2. **Cross-system field standardization** — No canonical field set enforced across systems.
3. **Sparse PostHog events** — Missing agent-level, phase-level, and LLM cost events.
4. **Incomplete Langfuse scores** — `total_cost_usd` and `llm_call_count` not recorded.
5. **Inconsistent structlog fields** — Events don't carry a standard context set.

## Requirements

### 1. Fix Langfuse Trace Hierarchy (Critical)

LLM calls must nest under their parent round trace and phase span, not create orphaned top-level traces.

**Acceptance Criteria:**
- [ ] Root cause identified and documented: determine why `trace_id`/`parent_observation_id` from `get_trace_context()` are not being consumed by litellm's Langfuse callback
- [ ] All LLM calls (gm, agent, memory) appear as generations nested under their parent span in Langfuse, not as separate top-level traces
- [ ] Verified with a full experiment run: the Langfuse traces view shows only `round-{N}` traces, with all LLM calls nested inside

**Investigation approach:**
1. Check if litellm Router strips/restructures metadata keys before passing to the Langfuse callback
2. Check if `get_trace_context()` returns empty dict due to `_obj_id()` returning empty string
3. Verify litellm reads the exact metadata keys we're passing (`trace_id`, `parent_observation_id`)
4. Test with direct `litellm.acompletion()` bypassing Router to isolate

### 2. Define Canonical Context Fields

Define a standard set of context fields that MUST appear on every observability event, regardless of system.

**Acceptance Criteria:**
- [ ] Canonical field set defined and documented: `environment`, `experiment_id`, `round_number`, `agent_id`, `agent_name`, `phase`, `role`
- [ ] A shared helper function (e.g. `build_observability_context()`) constructs the canonical context dict from available state
- [ ] All structlog events emitted during a round carry the full canonical context via `structlog.contextvars`
- [ ] All PostHog events carry the canonical fields in their properties dict
- [ ] All Langfuse metadata includes the canonical fields
- [ ] Field names are identical across all three systems (no `trace_user_id` vs `agent_name` divergence)

### 3. Expand PostHog Event Coverage

Add agent-level and phase-level events so PostHog can answer questions like "which agents fail most?" and "which phases are slowest?"

**Acceptance Criteria:**
- [ ] `agent_decision` event captured per agent turn: `experiment_id`, `round_number`, `agent_id`, `agent_name`, `action_type`, `phase`, `cooperation_intent`, `model`
- [ ] `agent_decision_fallback` event captured when AgentBrain falls back to OBSERVE: `experiment_id`, `round_number`, `agent_id`, `agent_name`, `error_type`
- [ ] `round_llm_cost` event captured per round with aggregated LLM cost: `experiment_id`, `round_number`, `total_cost_usd`, `call_count`, `total_tokens`
- [ ] `phase_completed` event captured per phase: `experiment_id`, `round_number`, `phase`, `duration_seconds`, `agent_count`
- [ ] All new PostHog events use the canonical field names from Req 2

### 4. Complete Langfuse Scores

Record the remaining round-level metrics as Langfuse scores.

**Acceptance Criteria:**
- [ ] `total_cost_usd` recorded as a numeric score on each round trace (sum of all LLM calls in the round)
- [ ] `llm_call_count` recorded as a numeric score on each round trace

### 5. Standardize Structlog Events

Ensure all structlog events carry consistent context and follow naming conventions.

**Acceptance Criteria:**
- [ ] All structlog events during a round carry `experiment_id` and `round_number` via `structlog.contextvars` (bound once at round start, not passed per-call)
- [ ] Agent-scoped events also bind `agent_id` and `agent_name` in context
- [ ] Event names follow `{domain}_{action}` convention: `round_started`, `round_completed`, `agent_decided`, `llm_parse_failed`, `phase_completed`
- [ ] No structlog event emits a field that conflicts with a canonical field name (e.g. no `model` that means different things in different events)

## Technical Design

### Canonical Context via structlog.contextvars

Bind canonical fields once per round using `structlog.contextvars.bind_contextvars()`. These automatically appear on every structlog event within the async context:

```python
# At round start in SimulationEngine.run_round():
structlog.contextvars.bind_contextvars(
    environment=settings.env,
    experiment_id=state.experiment_id,
    round_number=round_number,
)

# At agent scope:
structlog.contextvars.bind_contextvars(
    agent_id=agent.agent_id,
    agent_name=agent.name,
)
```

This eliminates per-event field passing and guarantees consistency.

### PostHog Event Helper

Add a helper that merges canonical context into PostHog event properties:

```python
def capture_with_context(event: str, properties: dict[str, object]) -> None:
    """Capture a PostHog event with canonical context from structlog contextvars."""
    ctx = structlog.contextvars.get_contextvars()
    merged = {
        "environment": ctx.get("environment"),
        "experiment_id": ctx.get("experiment_id"),
        "round_number": ctx.get("round_number"),
        "agent_id": ctx.get("agent_id"),
        "agent_name": ctx.get("agent_name"),
        **properties,
    }
    ph.capture(event, {k: v for k, v in merged.items() if v is not None})
```

### Langfuse Scores Completion

In `engine/service.py`, compute `total_cost_usd` and `llm_call_count` from the usage tracker at end of round and add to the existing `record_scores()` call.

## Key Files

- `backend/app/core/posthog.py` — Add `capture_with_context()` helper
- `backend/app/core/langfuse.py` — Trace hierarchy investigation
- `backend/app/llm/client.py` — Langfuse metadata, trace context debugging
- `backend/app/engine/service.py` — Bind contextvars, add PostHog events, complete scores
- `backend/app/agents/brain.py` — Add PostHog `agent_decision` and `agent_decision_fallback` events
- `backend/app/api/runtime.py` — Update existing PostHog events to use canonical fields

## Rollout

1. **Fix trace hierarchy** — Investigate root cause, fix, verify with experiment run
2. **Define canonical fields + structlog contextvars** — Bind at round/agent scope
3. **Add PostHog helper + new events** — Agent decisions, fallbacks, phase timing, round cost
4. **Complete Langfuse scores** — Add cost and call count
5. **Validate** — Run full experiment, verify all three dashboards show consistent, filterable data
