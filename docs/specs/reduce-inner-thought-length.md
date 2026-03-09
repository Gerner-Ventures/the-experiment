---
title: "Reduce Agent Inner Thought Length"
type: spec
status: in_progress
owner: ""
team: backend
review_status: draft
tags: [agents, llm, game-flow, ux]
depends_on: []
created: "2026-03-07"
updated: "2026-03-07"
---

# Reduce Agent Inner Thought Length

## 1. Background

The `inner_thoughts` field returned by agent LLM calls is excessively long, often producing multi-paragraph internal monologues. This creates two problems:

1. **Slow game flow** — Long thoughts take significant time to generate (more output tokens = longer latency per agent step), slowing the overall simulation pace.
2. **Poor viewing experience** — When displayed in the frontend (conversation bubbles, agent dossier, experiment log), walls of text are hard to read and break the immersive game feel.

Inner thoughts should be concise — a brief window into the agent's reasoning, not an essay. Think 1-2 short sentences, not 5-10.

## 2. Requirements

### Acceptance Criteria

- [x] Agent inner thoughts are limited to 1-2 concise sentences via prompt engineering (no hard schema constraint to avoid malformed JSON)
<!-- canon:realized-in:PR#108 file:backend/app/schemas/agent_decision.py -->
<!-- canon:realized-in:PR#108 file:shared/schemas/agent_decision.json -->
- [x] LLM prompt templates explicitly instruct brevity for the `inner_thoughts` field
<!-- canon:realized-in:PR#108 file:backend/app/agents/brain.py -->
<!-- canon:realized-in:PR#174 file:backend/app/agents/brain.py -->
- [x] Token budget or max_tokens constraint is applied to inner thought generation where possible
- [ ] Existing game flow and agent decision quality is not degraded by shorter thoughts
- [ ] Frontend conversation bubbles and log entries render cleanly without overflow

## 3. Design

### Approach Options

1. **Prompt engineering** — ✅ Implemented: System and user prompts now explicitly constrain `inner_thoughts` to 1-2 sentences (300 character max). Max tokens increased to 2048 to accommodate structured output overhead.. This pattern was also applied to GM narration (PR #138), which caps at 45 words with similar prompt constraints.ences under 160 characters with examples of good/bad thoughts. Add examples of good vs bad thought length.
2. **Schema constraint** — Add `maxLength` to the `inner_thoughts` field in the response schema or function call definition.
3. **Post-processing truncation** — Truncate thoughts server-side before broadcasting to the frontend (least preferred — wastes tokens).

Recommended: Combine option 1 (prompt engineering) with option 2 (schema constraint) for reliability.

### Key Files to Investigate

- Agent prompt templates (system prompts, action prompts)
- `inner_thoughts` field definition in agent response models
- Any `max_tokens` settings on agent LLM calls

## 4. Rollout Plan

1. Audit current prompt templates for inner thought instructions
2. Update prompts with explicit brevity constraints and examples
3. Add schema-level length constraints
4. Test with a few simulation runs to verify quality and length
5. Monitor token usage reduction as a success metric
