---
title: "Fix Structured Output Nesting Failures & Simplify LLM Client"
status: in_progress
priority: critical
tags: [agents, llm, reliability, parsing, litellm]
depends_on: [llm-structured-output-truncation]
updated: "2026-03-09"
---

# Fix Structured Output Nesting Failures & Simplify LLM Client

## Background

Agent LLM calls fail at ~100% rate in certain rounds because `claude-haiku-4-5-20251001` consistently wraps all top-level fields inside the `action` key:

```
Expected: {"inner_thought": "...", "action": {"type": "explore"}, "cooperation_intent": "high"}
Actual:   {"action": {"inner_thought": "...", "type": "explore", "cooperation_intent": "high"}}
```

Key observations from PostHog logs (2026-03-09):
- **100% of failures** show the same nesting pattern
- **100% have `finish_reason: stop`** — not truncation, confident wrong structure
- **Both retry attempts fail identically** — blind retry doesn't help
- **20+ failures** in ~90 seconds from one round (all agents failing)
- All from `claude-haiku-4-5-20251001`, experiment `75367e1f`

The existing retry (added in PR #174) replays the same request, but since the model consistently misunderstands the schema, blind retry produces the same error.

## Requirements

### 1. Structural Repair for Nested Responses

When the model wraps all required top-level fields inside `action`, detect and un-nest them before Pydantic validation.

**Acceptance Criteria:**
- [ ] When Pydantic validation fails and the payload has top-level fields nested inside a known key (e.g. `action`), the parser attempts to un-nest and re-validate
- [ ] Repair only fires when the nested dict contains the expected top-level fields (not for arbitrary malformed JSON)
- [ ] Successful repairs are logged at `info` level with the repair type
- [ ] Tests verify repair for the exact nesting pattern seen in production

### 2. Corrective Retry with Error Context

On parse failure, include the validation error in the retry so the model can self-correct.

**Acceptance Criteria:**
- [ ] On first parse failure, the retry appends an assistant message with the malformed response and a user message explaining the structural error
- [ ] The corrective message specifies which fields should be at top level vs nested
- [ ] Tests verify that corrective retry produces a valid response when the model "fixes" its output

### 3. Schema Reinforcement in Agent Prompt

Add explicit structural guidance to the agent system prompt.

**Acceptance Criteria:**
- [ ] System prompt includes a minimal JSON example showing the expected flat structure
- [ ] The example shows `action` as a nested object with only `type`/`target`/`location`, not containing other fields

## Technical Design

### Structural Repair

In `_parse_structured_content()`, after Pydantic `ValidationError`:

```python
# Check if all top-level fields are nested inside 'action'
if "action" in payload and isinstance(payload["action"], dict):
    nested = payload["action"]
    # Try to split: top-level fields go up, action-specific stay
    repaired = {k: v for k, v in nested.items() if k not in ("type", "target", "location")}
    repaired["action"] = {k: v for k, v in nested.items() if k in ("type", "target", "location")}
    try:
        return response_format.model_validate(repaired).model_dump(mode="json")
    except ValidationError:
        pass  # Repair failed, fall through
```

### Corrective Retry

Instead of replaying the exact same request, append context:

```python
messages.append({"role": "assistant", "content": result.content})
messages.append({"role": "user", "content": (
    "Your response had incorrect JSON structure. "
    "All fields (inner_thought, suspicion, action, dialogue, goal_progress, cooperation_intent) "
    "must be at the TOP LEVEL of the JSON object. "
    "The 'action' field should only contain 'type', 'target', and 'location'. "
    "Please return the corrected JSON."
)})
```

## Key Files

- `backend/app/llm/client.py` — Repair logic, corrective retry
- `backend/app/agents/brain.py` — Schema reinforcement in prompt
- `backend/tests/test_llm_integration.py` — Tests for repair and corrective retry
