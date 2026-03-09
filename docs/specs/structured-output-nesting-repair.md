---
title: "Fix Structured Output Failures & Simplify LLM Client"
status: done
priority: critical
tags: [agents, llm, reliability, parsing, litellm]
depends_on: [llm-structured-output-truncation]
updated: "2026-03-09"
---

# Fix Structured Output Failures & Simplify LLM Client

## Background

Agent LLM calls failed at ~100% rate in certain rounds because `claude-haiku-4-5-20251001` consistently wrapped all top-level fields inside the `action` key. The root cause was that we were not using litellm's structured output support properly — we disabled `enable_json_schema_validation` and did manual JSON parsing instead of letting litellm handle provider-specific translation (Anthropic tool_use, OpenAI json_schema).

## Requirements

### 1. Use litellm Structured Outputs Properly

Pass Pydantic `BaseModel` as `response_format` and let litellm handle provider translation.

**Acceptance Criteria:**
- [x] `response_format=BaseModel` passed directly to litellm Router
- [x] `litellm.enable_json_schema_validation = True` re-enabled (safe after maxLength removal in PR #174)
- [x] `model_validate_json()` used instead of manual `json.loads` + `model_validate`
- [x] Markdown fence stripping removed (litellm handles this)

### 2. Corrective Retry with Error Context

On parse failure, include the failed response in the retry so the model can self-correct.

**Acceptance Criteria:**
- [x] On first parse failure, the retry appends an assistant message with the malformed response and a user message asking for corrected JSON
- [x] Tests verify that corrective retry produces a valid response when the model self-corrects

### 3. Schema Reinforcement in Agent Prompt

Add explicit structural guidance to the agent system prompt.

**Acceptance Criteria:**
- [x] System prompt includes a minimal JSON example showing the expected flat structure
- [x] The example shows `action` as a nested object with only `type`/`target`/`location`

### 4. Simplify LLM Client

Remove custom code that duplicates litellm functionality.

**Acceptance Criteria:**
- [x] Removed structural repair logic (`_try_repair_nesting`) — unnecessary with provider-enforced schemas
- [x] Removed unused `_build_metadata` params (`generation_name_override`, `extra`)
- [x] Inlined `_infer_provider` (single-use 3-line method)
- [x] `client.py` reduced from 372 → ~245 lines (-34%)

## Key Files

- `backend/app/llm/client.py` — Simplified structured output parsing, corrective retry
- `backend/app/agents/brain.py` — Schema reinforcement in prompt
- `backend/tests/test_llm_integration.py` — Tests for corrective retry
