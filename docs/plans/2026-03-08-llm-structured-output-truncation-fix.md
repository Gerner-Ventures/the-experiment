# Fix LLM Structured Output Truncation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate silent agent turn failures caused by LLM structured output parse failures, by removing the harmful `max_length` schema constraint, adding retry-on-parse-failure, and enriching error telemetry.

**Architecture:** Remove the `AGENT_INNER_THOUGHT_MAX_LENGTH` Pydantic constraint that causes the model to produce malformed JSON. Add a single retry in `LLMClient.generate_structured()` before raising on parse failure. Enrich PostHog `llm_parse_failure` events with diagnostic metadata.

**Tech Stack:** Python, Pydantic, litellm, structlog, PostHog

---

### Task 1: Remove `max_length` constraint from `inner_thought`

**Files:**
- Modify: `backend/app/schemas/agent_decision.py`

**Step 1: Update `inner_thought` field — remove `max_length` and `AGENT_INNER_THOUGHT_MAX_LENGTH`**

Remove the `AGENT_INNER_THOUGHT_MAX_LENGTH` constant and the `max_length` parameter from the `inner_thought` field. Keep `min_length=1` and the description.

```python
# Before:
AGENT_INNER_THOUGHT_MAX_LENGTH = 300

class AgentDecision(APIModel):
    inner_thought: str = Field(
        min_length=1,
        max_length=AGENT_INNER_THOUGHT_MAX_LENGTH,
        description=(...),
    )

# After:
class AgentDecision(APIModel):
    inner_thought: str = Field(
        min_length=1,
        description=(
            "A brief window into the agent's immediate reasoning. Keep it to 1-2 short "
            "sentences and avoid monologues."
        ),
    )
```

**Step 2: Run type-check to confirm no broken references**

Run: `cd backend && python -m mypy app/schemas/agent_decision.py --ignore-missing-imports`

---

### Task 2: Update brain.py — remove hard character cap from prompts

**Files:**
- Modify: `backend/app/agents/brain.py`

**Step 1: Remove `AGENT_INNER_THOUGHT_MAX_LENGTH` import and references**

Remove the import of `AGENT_INNER_THOUGHT_MAX_LENGTH` from the imports.

In `build_agent_prompt()`, change:
```python
f"- Keep `inner_thought` to 1-2 short sentences under {AGENT_INNER_THOUGHT_MAX_LENGTH} characters.\n"
```
to:
```python
"- Keep `inner_thought` to 1-2 short sentences.\n"
```

In the system message in `AgentBrain.decide()`, change:
```python
f"`inner_thought` must be 1-2 short sentences under {AGENT_INNER_THOUGHT_MAX_LENGTH} "
"characters, with no monologue."
```
to:
```python
"`inner_thought` must be 1-2 short sentences, no monologue."
```

**Step 2: Verify no remaining references**

Run: `cd backend && grep -r "AGENT_INNER_THOUGHT_MAX_LENGTH" app/`
Expected: No matches.

---

### Task 3: Update tests — remove overlong inner thought test, fix imports

**Files:**
- Modify: `backend/tests/test_llm_integration.py`

**Step 1: Remove `test_agent_decision_rejects_overlong_inner_thought` test**

Delete the entire test function `test_agent_decision_rejects_overlong_inner_thought` (lines 154-165). This behavior is no longer enforced.

**Step 2: Remove `AGENT_INNER_THOUGHT_MAX_LENGTH` from imports**

Remove `AGENT_INNER_THOUGHT_MAX_LENGTH` from the import block.

**Step 3: Add `finish_reason` to `_FakeChoice`**

The retry logic (Task 4) needs `finish_reason` on choices. Update `_FakeChoice`:

```python
class _FakeChoice:
    def __init__(self, content: str, finish_reason: str = "stop") -> None:
        self.message = _FakeMessage(content)
        self.finish_reason = finish_reason
```

**Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_llm_integration.py -v`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add backend/app/schemas/agent_decision.py backend/app/agents/brain.py backend/tests/test_llm_integration.py
git commit -m "fix: remove max_length constraint on agent inner_thought

The maxLength schema constraint was causing the LLM to produce malformed/nested
JSON trying to compress its output, leading to parse failures and silent fallback
to OBSERVE actions."
```

---

### Task 4: Add retry-on-parse-failure in `generate_structured()`

**Files:**
- Modify: `backend/app/llm/client.py`
- Test: `backend/tests/test_llm_integration.py`

**Step 1: Write the failing test — retry succeeds on second attempt**

Add to `test_llm_integration.py`:

```python
@pytest.mark.asyncio
async def test_structured_generation_retries_on_parse_failure() -> None:
    """When the first response fails to parse, retry once before raising."""
    broken = _FakeResponse("openai/gpt-4o-mini", "not-json")
    valid_content = json.dumps(
        {
            "inner_thought": "I should keep quiet.",
            "suspicion": None,
            "action": {"type": "observe"},
            "dialogue": None,
            "goal_progress": "No progress yet.",
            "cooperation_intent": "medium",
        }
    )
    valid = _FakeResponse("openai/gpt-4o-mini", valid_content)
    client = LLMClient()
    fake_router = _FakeRouter([broken, valid])
    client.router = fake_router

    result = await client.generate_structured(
        request=client_request(
            "agent",
            AgentDecision,
            {"experiment_id": "exp-retry", "round_number": 1, "agent_id": "a-1"},
        )
    )

    assert result.parsed is not None
    assert result.parsed["inner_thought"] == "I should keep quiet."
    assert len(fake_router.calls) == 2  # Two calls were made
```

**Step 2: Write the failing test — retry exhausted still raises**

```python
@pytest.mark.asyncio
async def test_structured_generation_raises_after_retry_exhausted() -> None:
    """When both attempts fail to parse, raise ValueError."""
    broken1 = _FakeResponse("openai/gpt-4o-mini", "not-json-1")
    broken2 = _FakeResponse("openai/gpt-4o-mini", "not-json-2")
    client = LLMClient()
    fake_router = _FakeRouter([broken1, broken2])
    client.router = fake_router

    with pytest.raises(ValueError, match="did not match expected structured format"):
        await client.generate_structured(
            request=client_request(
                "agent",
                AgentDecision,
                {"experiment_id": "exp-retry2", "round_number": 1, "agent_id": "a-1"},
            )
        )

    assert len(fake_router.calls) == 2
```

**Step 3: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_llm_integration.py::test_structured_generation_retries_on_parse_failure tests/test_llm_integration.py::test_structured_generation_raises_after_retry_exhausted -v`
Expected: FAIL

**Step 4: Implement retry logic in `generate_structured()`**

In `client.py`, refactor `generate_structured()` to wrap the call+parse in a loop with max 2 attempts:

```python
async def generate_structured(self, request: LLMRequest) -> LLMResult:
    model_config = self._resolve_model_config(request)
    messages = list(request.messages)
    api_response_format: dict[str, Any] | type[BaseModel] | None = request.response_format

    if isinstance(request.response_format, type) and issubclass(
        request.response_format, BaseModel
    ):
        api_response_format = request.response_format

    metadata = self._build_metadata(request)
    log.debug(
        "langfuse_context",
        trace_id=metadata.get("trace_id"),
        parent_observation_id=metadata.get("parent_observation_id"),
        generation_name=metadata.get("generation_name"),
        has_context=bool(get_trace_context()),
    )

    max_attempts = 2 if request.response_format is not None else 1
    last_error: ValueError | None = None

    for attempt in range(max_attempts):
        response = await self.router.acompletion(
            model=request.model_override or model_config.primary_model,
            messages=cast(Any, messages),
            response_format=api_response_format,
            temperature=request.temperature
            if request.temperature is not None
            else model_config.temperature,
            max_tokens=request.max_tokens,
            timeout=model_config.timeout_seconds,
            metadata=metadata,
        )
        result = self._build_result(response)
        finish_reason = (
            getattr(response.choices[0], "finish_reason", None) if response.choices else None
        )

        if request.response_format is not None:
            parsed = self._parse_structured_content(result.content, request.response_format)
            if parsed is None:
                log.warning(
                    "llm_structured_parse_failed",
                    role=request.role,
                    model=result.model,
                    experiment_id=request.metadata.get("experiment_id"),
                    content_preview=result.content[:300],
                    finish_reason=finish_reason,
                    completion_tokens=result.usage.completion_tokens,
                    max_tokens_requested=request.max_tokens,
                    attempt=attempt + 1,
                    max_attempts=max_attempts,
                )
                last_error = ValueError(
                    f"model response did not match expected structured format. "
                    f"Raw content: {result.content[:300]}"
                )
                if attempt < max_attempts - 1:
                    continue  # Retry
                # Final attempt failed — capture and raise
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
                raise last_error
            else:
                result.parsed = parsed

        self._track_usage(request, result)
        return result

    # Unreachable, but satisfies type checker
    raise last_error or RuntimeError("unexpected state in generate_structured")
```

**Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_llm_integration.py -v`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add backend/app/llm/client.py backend/tests/test_llm_integration.py
git commit -m "feat: retry once on structured output parse failure before raising

Adds a single retry of the LLM call when JSON parsing fails, before
falling back to the error path. Also enriches PostHog llm_parse_failure
events with finish_reason, completion_tokens, and max_tokens metadata."
```

---

### Task 5: Update the spec status

**Files:**
- Modify: `docs/specs/llm-structured-output-truncation.md`

**Step 1: Update spec frontmatter status to `in_progress`**

Change `status: todo` to `status: in_progress`.

**Step 2: Check off completed ACs**

- [x] `finish_reason` is checked before attempting JSON parse (already logged, retry handles it)
- [x] `finish_reason` is included in all structured parse error logs
- [x] Retry-on-parse-failure strategy implemented
- [x] `llm_structured_parse_failed` log includes full metadata
- [x] Agent decision fallback to OBSERVE logged at warning level (already was)
- [ ] Structured output prompt injection improved (deferred — removing max_length addresses root cause)

**Step 3: Commit**

```bash
git add docs/specs/llm-structured-output-truncation.md
git commit -m "docs: update LLM truncation spec status to in_progress"
```
