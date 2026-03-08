---
title: "Fix LLM Structured Output Truncation"
type: spec
status: in_progress
owner: ""
team: backend
review_status: draft
tags: [agents, llm, reliability, parsing]
depends_on: []
created: "2026-03-08"
updated: "2026-03-08"
---

# Fix LLM Structured Output Truncation

## 1. Background

Agent LLM calls intermittently fail with `llm_structured_parse_failed` because the model returns incomplete JSON. Observed in production with `claude-haiku-4-5-20251001`:

- `finish_reason: "stop"` with only 242-263 `completion_tokens` out of the available budget
- The `content_preview` shows truncated JSON mid-field (e.g., `"suspicion": "The Volunteer"` cut off, missing closing braces)
- The model sometimes nests fields incorrectly (e.g., `inner_thought` inside `action` instead of at the top level)
- The existing `_repair_json()` mechanism fails to salvage the response
- `AgentBrain.decide()` silently falls back to a default `OBSERVE` action, meaning the agent effectively skips a turn

This degrades gameplay — agents that should be taking meaningful actions (talk, investigate, accuse) instead passively observe because their LLM call silently failed.

### Current Flow

```
LLM response (truncated JSON, finish_reason=stop)
  → _parse_structured_content() fails
  → _repair_json() fails
  → llm_structured_parse_failed logged
  → ValueError raised
  → AgentBrain catches → fallback OBSERVE
```

### Affected Files

- `backend/app/llm/client.py` — parsing and repair logic
- `backend/app/agents/brain.py` — fallback handling
- `backend/app/schemas/agent_decision.py` — `AGENT_DECISION_MAX_TOKENS` (was 384, now 2048); `max_length` on `inner_thought` removed (was root cause of malformed JSON)

## 2. Requirements

### Acceptance Criteria

- [x] `finish_reason` is checked before attempting JSON parse; truncated responses (`finish_reason=length`) trigger a retry with increased `max_tokens` instead of going straight to repair
<!-- canon:realized-in:file:backend/app/llm/client.py -->
- [x] `finish_reason` is included in all structured parse error logs and Langfuse traces for easier debugging
<!-- canon:realized-in:file:backend/app/llm/client.py -->
- [x] A retry-on-parse-failure strategy is implemented: retry the original request (up to 1 additional attempt) before falling back to the repair path
<!-- canon:realized-in:file:backend/app/llm/client.py -->
- [x] The `llm_structured_parse_failed` log event includes the full `finish_reason`, `completion_tokens`, and `max_tokens` in its metadata
<!-- canon:realized-in:file:backend/app/llm/client.py -->
- [x] Agent decision fallback to OBSERVE is logged at `warning` level with the original error context (not silently swallowed)
<!-- canon:realized-in:file:backend/app/agents/brain.py -->
- [ ] Structured output prompt injection is improved to reinforce the flat JSON structure (fields at top level, not nested)

## 3. Design

### 3.1 Check `finish_reason` Before Parsing

In `LLMClient.generate_structured()`, inspect `response.choices[0].finish_reason` before calling `_parse_structured_content()`:

- **`finish_reason == "length"`**: The response was truncated by `max_tokens`. Retry with `max_tokens * 2` (capped at 2048). Do not attempt repair on a known-truncated response.
- **`finish_reason == "stop"`** with invalid JSON: Proceed to retry → repair → fallback chain as usual.

### 3.2 Retry Before Repair

Add a single retry of the original request before invoking `_repair_json()`:

```
Parse fails → Retry original request (1x) → Parse again → Repair → Raise
```

The retry is cheaper and faster than the repair path (which makes a separate LLM call with the broken output).

### 3.3 Enhanced Error Logging

Add to `llm_structured_parse_failed` metadata:
- `finish_reason`
- `completion_tokens`
- `max_tokens`
- `content_length` (character count of raw response)

### 3.4 Improve Schema Prompt

In the system prompt injection for structured output, add explicit instruction:
- "All fields must be at the top level of the JSON object. Do not nest fields inside other fields."
- Include a minimal example of the expected JSON shape

### 3.5 Fallback Visibility

In `AgentBrain.decide()`, ensure the fallback path logs:
- The original exception message
- The agent name and round number
- That a fallback OBSERVE was used (so it's distinguishable from intentional OBSERVE actions)

## 4. Rollout Plan

1. Add `finish_reason` to structured parse error logs (quick win, improves debugging immediately)
2. Implement retry-before-repair in `LLMClient.generate_structured()`
3. Add `finish_reason == "length"` detection with token budget increase
4. Update schema prompt injection with flat-structure reinforcement
5. Improve fallback logging in `AgentBrain.decide()`
6. Run 2-3 full experiment simulations and verify reduced `llm_structured_parse_failed` rate
