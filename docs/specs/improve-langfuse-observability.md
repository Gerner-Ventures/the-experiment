---
title: "Improve Langfuse Observability"
status: todo
priority: high
tags: [stream-3, infra, observability, langfuse, tracing]
depends_on: [s3.6-langfuse-tracing]
---

# Improve Langfuse Observability

Fix broken trace hierarchy and enrich Langfuse data so that every LLM call is navigable by experiment, round, phase, and agent — with descriptive names, tags, and quality scores.

## Background

S3.6 established the Langfuse integration: litellm callback registration, trace/span creation per round and phase, and context propagation via `contextvars`. The infrastructure is in place, but the Langfuse dashboard reveals that **it isn't working as intended**:

1. **Orphaned traces** — 106 of 107 traces show as top-level `litellm-acompletion` instead of nesting under `round-{N}` traces. The `trace_id`/`parent_observation_id` context propagation is failing silently.
2. **Generic names** — Every LLM call is named `litellm-acompletion`. There's no way to distinguish GM plans from agent decisions from memory operations at a glance.
3. **No session/user IDs** — LLM call traces don't carry `session_id` (experiment) or `user_id`, making cross-round analysis impossible.
4. **No tags** — Can't filter by arc, act, agent archetype, or LLM role.
5. **No scores** — Round-level metrics (cooperation_ratio, threat_level, cost) aren't recorded as Langfuse scores.
6. **Missing context on memory calls** — Memory service calls don't pass `experiment_id`, `agent_id`, or `agent_name`, making them unattributable.

The result is a dashboard full of undifferentiated, unlinked LLM calls that provide almost no observability value.

## Requirements

### 1. Fix Trace Hierarchy (Critical)

LLM calls must nest under their parent round trace and phase span, not create orphaned top-level traces.

**Acceptance Criteria:**
- [ ] Root cause identified and documented: determine why `trace_id`/`parent_observation_id` from `get_trace_context()` are not being consumed by litellm's Langfuse callback
- [ ] All LLM calls (gm, agent, memory) appear as **generations** nested under their parent span in Langfuse, not as separate top-level traces
- [ ] Verified with a full experiment run: the Langfuse traces view shows only `round-{N}` traces, with all LLM calls nested inside
- [ ] Add a debug log in `LLMClient.generate_structured()` that logs `trace_id` and `parent_observation_id` values at DEBUG level before passing to litellm

### 2. Descriptive Generation Names

Replace the generic `litellm-acompletion` name with role-specific names.

**Acceptance Criteria:**
- [ ] GM plan calls named `gm-plan`
- [ ] Agent decision calls named `agent:{agent_name}` (e.g., `agent:The Intern`)
- [ ] Memory classify calls named `memory:classify:{agent_name}`
- [ ] Memory consolidate calls named `memory:consolidate:{agent_name}`
- [ ] Relationship consolidate calls named `memory:relationship:{agent_name}`
- [ ] JSON repair calls named `{role}:repair`
- [ ] Names passed via the `generation_name` metadata key (already partially implemented but using only the role string)

### 3. Session and User ID Propagation

Every LLM call must carry session and user context so Langfuse can group by experiment and attribute to agents.

**Acceptance Criteria:**
- [ ] `session_id` (set to `experiment_id`) passed in metadata for all LLM calls
- [ ] `trace_user_id` (set to `agent_name` or `"gm"` or `"system"`) passed in metadata for all LLM calls
- [ ] Langfuse Sessions view shows experiments grouped by session with all their rounds

### 4. Tags for Filtering

Add structured tags to enable Langfuse dashboard filtering.

**Acceptance Criteria:**
- [ ] Round traces tagged with: arc name (e.g., `arc:lord-of-the-flies`), current act (e.g., `act:false-peace`), experiment status
- [ ] LLM call metadata includes `tags` array with: role (e.g., `role:agent`), phase (e.g., `phase:morning`), and agent archetype when applicable (e.g., `archetype:resource_control`)
- [ ] Tags follow a `namespace:value` convention for consistency

### 5. Langfuse Scores

Record round-level metrics as Langfuse scores for trend analysis.

**Acceptance Criteria:**
- [ ] `cooperation_ratio` recorded as a numeric score on each round trace
- [ ] `threat_level` recorded as a numeric score on each round trace
- [ ] `total_cost_usd` recorded as a numeric score on each round trace (sum of all LLM calls in the round)
- [ ] `llm_call_count` recorded as a numeric score on each round trace
- [ ] Scores use the Langfuse `score()` API, not just metadata

### 6. Enrich Memory Call Metadata

Memory service calls currently pass minimal metadata. Add context so they're attributable.

**Acceptance Criteria:**
- [ ] All memory LLM calls (`classify_memory_event`, `consolidate_memory_events`, `consolidate_relationship_memory`) include `experiment_id`, `agent_id`, and `agent_name` in their metadata
- [ ] Memory calls include the `round_number` consistently (relationship consolidation currently omits it)
- [ ] The calling code in `SimulationEngine._night_phase` passes agent context through to the LLM service

### 7. Trace Input/Output Recording

Record structured round context as trace input and results as trace output for debugging.

**Acceptance Criteria:**
- [ ] Round trace `input` set to a summary of world state: resources, threat_level, cooperation_ratio, agent count, arc, act
- [ ] Round trace `output` set to a summary of round results: events count, status changes, resource deltas
- [ ] Keep input/output concise (not full state dumps) to stay within Langfuse size limits

## Technical Design

### Root Cause Investigation (Req 1)

The most likely causes of orphaned traces, in order of probability:

1. **litellm Router metadata handling** — The `Router.acompletion()` method may strip or restructure custom metadata keys before passing them to the Langfuse callback. Test with direct `litellm.acompletion()` to isolate.
2. **Empty trace context** — `get_trace_context()` may return `{}` if `_obj_id()` returns empty string for the trace/span objects (the `or ""` fallback is truthy-falsy ambiguous). Add explicit None checks.
3. **Async context loss** — The `contextvars.ContextVar` should propagate through `await` chains, but if litellm's Router spawns threads internally, the context could be lost. Since we read the contextvar and merge into the metadata dict before calling Router, this should not be the issue — but verify.
4. **Langfuse SDK version mismatch** — litellm's built-in callback may expect different metadata keys than what we're passing. Check litellm source for the exact keys it reads.

**Investigation steps:**
```python
# Add to LLMClient.generate_structured() before the router call:
log.debug(
    "langfuse_context",
    trace_id=metadata.get("trace_id"),
    parent_observation_id=metadata.get("parent_observation_id"),
    generation_name=metadata.get("generation_name"),
    has_context=bool(get_trace_context()),
)
```

### Metadata Enrichment (Reqs 2-4, 6)

Update `LLMClient.generate_structured()` to build richer metadata:

```python
metadata = {
    **request.metadata,
    **get_trace_context(),
    # Descriptive name (Req 2)
    "generation_name": request.generation_name or request.role,
    # Session/user (Req 3)
    "session_id": request.metadata.get("experiment_id", ""),
    "trace_user_id": request.metadata.get("agent_name", request.role),
    # Tags (Req 4)
    "tags": request.metadata.get("tags", []),
}
```

Add `generation_name` field to `LLMRequest` model. Update call sites:

- `GMService.generate_plan()` → `generation_name="gm-plan"`
- `AgentBrain.decide()` → `generation_name=f"agent:{agent_name}"`
- `LLMService.classify_memory_event()` → `generation_name=f"memory:classify:{agent_name}"`
- `LLMService.consolidate_memory_events()` → `generation_name=f"memory:consolidate:{agent_name}"`
- `LLMService.consolidate_relationship_memory()` → `generation_name=f"memory:relationship:{agent_name}"`

### Scores (Req 5)

Add a `record_scores()` helper to `langfuse.py`:

```python
def record_scores(
    trace_id: str,
    scores: dict[str, float],
) -> None:
    if _client is None:
        return
    for name, value in scores.items():
        try:
            _client.score(
                trace_id=trace_id,
                name=name,
                value=value,
            )
        except Exception:
            logger.warning("langfuse score failed", exc_info=True)
```

Called at the end of `run_round()` after trace update:

```python
if trace is not None:
    lf.record_scores(
        trace_id=self._obj_id(trace),
        scores={
            "cooperation_ratio": cooperation_ratio,
            "threat_level": state.world_state.threat_level,
            "total_cost_usd": total_round_cost,
            "llm_call_count": total_llm_calls,
        },
    )
```

### Trace I/O (Req 7)

Set input/output on the round trace:

```python
trace = lf.trace(
    name=f"round-{round_number}",
    session_id=state.experiment_id,
    input={
        "round": round_number,
        "arc": state.arc.name,
        "act": current_act.name,
        "resources": state.world_state.resources,
        "threat_level": state.world_state.threat_level,
        "agent_count": len(state.agents),
    },
    metadata={...},
)

# After round completes:
trace.update(
    output={
        "status": state.status,
        "cooperation_ratio": cooperation_ratio,
        "threat_level": state.world_state.threat_level,
        "event_count": sum(len(pr.events) for pr in phases),
    },
)
```

## Key Files

- `backend/app/core/langfuse.py` — Add `record_scores()`, enhance `trace()` signature
- `backend/app/llm/client.py` — Enrich metadata, add debug logging
- `backend/app/llm/models.py` — Add `generation_name` to `LLMRequest`
- `backend/app/llm/service.py` — Pass `generation_name`, `agent_name`, `experiment_id` to all memory calls
- `backend/app/engine/service.py` — Pass agent context to memory calls, add scores, trace I/O
- `backend/app/gm/service.py` — Add `generation_name` to GM metadata
- `backend/app/agents/brain.py` — Add `generation_name` and `agent_name` to agent metadata

## Rollout

1. **Investigate** — Add debug logging, run one experiment, verify trace context values
2. **Fix hierarchy** — Resolve root cause, verify nesting in Langfuse dashboard
3. **Enrich** — Add names, tags, session/user IDs, memory context
4. **Scores** — Add round-level scores
5. **Validate** — Run a full 15-round experiment, verify dashboard shows clean hierarchy with all metadata
