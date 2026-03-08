# Improve Langfuse Observability — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken trace hierarchy and enrich Langfuse data so every LLM call is navigable by experiment, round, phase, and agent — with descriptive names, tags, and quality scores.

**Architecture:** Add a `generation_name` field to `LLMRequest`, enrich metadata at each call site with session/user/tag info, add debug logging in `LLMClient`, add a `record_scores()` helper to `langfuse.py`, and set trace input/output on round traces. Memory call sites get full agent context.

**Tech Stack:** Python, FastAPI, litellm, Langfuse SDK, Pydantic, pytest, structlog

---

## Key Files Reference

- `backend/app/core/langfuse.py` — Langfuse client singleton, trace/span/context helpers
- `backend/app/llm/client.py` — `LLMClient.generate_structured()` — metadata assembly + litellm Router call
- `backend/app/llm/models.py` — `LLMRequest`, `LLMResult`, `LLMRole` definitions
- `backend/app/llm/service.py` — `LLMService` with GM, agent, memory call wrappers
- `backend/app/engine/service.py` — `SimulationEngine.run_round()` — trace/span lifecycle, phase orchestration
- `backend/app/gm/service.py` — `GMService.generate_plan()` — GM LLM call site
- `backend/app/agents/brain.py` — `AgentBrain.decide()` — agent LLM call site
- `backend/tests/test_langfuse.py` — existing Langfuse tests

---

### Task 1: Add `generation_name` field to `LLMRequest`

**Files:**
- Modify: `backend/app/llm/models.py:26-32`
- Test: `backend/tests/test_langfuse.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_langfuse.py`:

```python
class TestLLMRequestGenerationName:
    def test_generation_name_field_defaults_to_none(self) -> None:
        from app.llm.models import LLMRequest
        req = LLMRequest(role="agent", messages=[{"role": "system", "content": "test"}])
        assert req.generation_name is None

    def test_generation_name_field_accepts_string(self) -> None:
        from app.llm.models import LLMRequest
        req = LLMRequest(
            role="agent",
            messages=[{"role": "system", "content": "test"}],
            generation_name="agent:The Intern",
        )
        assert req.generation_name == "agent:The Intern"
```

**Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestLLMRequestGenerationName -v`
Expected: FAIL — `generation_name` field does not exist on `LLMRequest`

**Step 3: Add `generation_name` to `LLMRequest`**

In `backend/app/llm/models.py`, add to the `LLMRequest` class after the `metadata` field:

```python
class LLMRequest(LLMModel):
    role: LLMRole
    messages: list[dict[str, Any]]
    response_format: dict[str, Any] | type[BaseModel] | None = None
    model_override: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    temperature: float | None = None
    generation_name: str | None = None
```

**Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestLLMRequestGenerationName -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/llm/models.py backend/tests/test_langfuse.py
git commit -m "feat(langfuse): add generation_name field to LLMRequest"
```

---

### Task 2: Use `generation_name` in `LLMClient` metadata + add debug logging

**Files:**
- Modify: `backend/app/llm/client.py:70-84`
- Test: `backend/tests/test_langfuse.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_langfuse.py`:

```python
class TestGenerationNameInMetadata:
    @pytest.mark.asyncio
    async def test_generation_name_used_over_role_when_provided(self) -> None:
        """When LLMRequest has generation_name set, it should appear in metadata instead of role."""
        import json
        from typing import Any
        from app.llm.client import LLMClient
        from app.llm.models import LLMRequest
        from app.schemas.agent_decision import AgentDecision

        class FakeResponse:
            def __init__(self) -> None:
                self.model = "openai/gpt-4o-mini"
                self.choices = [
                    type("C", (), {"message": type("M", (), {"content": json.dumps({
                        "inner_thought": "ok", "suspicion": None,
                        "action": {"type": "observe", "target": "well", "location": "well"},
                        "dialogue": None, "goal_progress": "none", "cooperation_intent": "medium",
                    })})()})()
                ]
                self.usage = type("U", (), {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})()
            def model_dump(self) -> dict[str, Any]:
                return {}

        class FakeRouter:
            def __init__(self) -> None:
                self.last_metadata: dict[str, Any] = {}
            async def acompletion(self, **kwargs: Any) -> FakeResponse:
                self.last_metadata = kwargs.get("metadata", {})
                return FakeResponse()

        client = LLMClient()
        fake_router = FakeRouter()
        client.router = fake_router  # type: ignore[assignment]

        await client.generate_structured(
            LLMRequest(
                role="agent",
                messages=[{"role": "system", "content": "test"}],
                response_format=AgentDecision,
                metadata={"experiment_id": "exp-1"},
                generation_name="agent:The Intern",
            )
        )
        assert fake_router.last_metadata["generation_name"] == "agent:The Intern"

    @pytest.mark.asyncio
    async def test_generation_name_falls_back_to_role(self) -> None:
        """When generation_name is None, metadata should use the role string."""
        import json
        from typing import Any
        from app.llm.client import LLMClient
        from app.llm.models import LLMRequest
        from app.schemas.agent_decision import AgentDecision

        class FakeResponse:
            def __init__(self) -> None:
                self.model = "openai/gpt-4o-mini"
                self.choices = [
                    type("C", (), {"message": type("M", (), {"content": json.dumps({
                        "inner_thought": "ok", "suspicion": None,
                        "action": {"type": "observe", "target": "well", "location": "well"},
                        "dialogue": None, "goal_progress": "none", "cooperation_intent": "medium",
                    })})()})()
                ]
                self.usage = type("U", (), {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})()
            def model_dump(self) -> dict[str, Any]:
                return {}

        class FakeRouter:
            def __init__(self) -> None:
                self.last_metadata: dict[str, Any] = {}
            async def acompletion(self, **kwargs: Any) -> FakeResponse:
                self.last_metadata = kwargs.get("metadata", {})
                return FakeResponse()

        client = LLMClient()
        fake_router = FakeRouter()
        client.router = fake_router  # type: ignore[assignment]

        await client.generate_structured(
            LLMRequest(
                role="agent",
                messages=[{"role": "system", "content": "test"}],
                response_format=AgentDecision,
                metadata={},
            )
        )
        assert fake_router.last_metadata["generation_name"] == "agent"
```

**Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestGenerationNameInMetadata -v`
Expected: First test FAILS — `generation_name` is `"agent"` (role fallback) instead of `"agent:The Intern"`

**Step 3: Update metadata assembly in `LLMClient.generate_structured()`**

In `backend/app/llm/client.py`, replace the metadata block (lines 70-74) with:

```python
        metadata = {
            **request.metadata,
            **get_trace_context(),
            "generation_name": request.generation_name or request.role,
        }
        log.debug(
            "langfuse_context",
            trace_id=metadata.get("trace_id"),
            parent_observation_id=metadata.get("parent_observation_id"),
            generation_name=metadata.get("generation_name"),
            has_context=bool(get_trace_context()),
        )
```

**Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestGenerationNameInMetadata -v`
Expected: PASS

**Step 5: Run all existing tests**

Run: `cd backend && python -m pytest tests/test_langfuse.py -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add backend/app/llm/client.py backend/tests/test_langfuse.py
git commit -m "feat(langfuse): use generation_name in metadata, add debug logging"
```

---

### Task 3: Add session_id and trace_user_id to metadata

**Files:**
- Modify: `backend/app/llm/client.py:70-84`
- Test: `backend/tests/test_langfuse.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_langfuse.py`:

```python
class TestSessionAndUserMetadata:
    @pytest.mark.asyncio
    async def test_session_id_from_experiment_id(self) -> None:
        import json
        from typing import Any
        from app.llm.client import LLMClient
        from app.llm.models import LLMRequest
        from app.schemas.agent_decision import AgentDecision

        class FakeResponse:
            def __init__(self) -> None:
                self.model = "openai/gpt-4o-mini"
                self.choices = [
                    type("C", (), {"message": type("M", (), {"content": json.dumps({
                        "inner_thought": "ok", "suspicion": None,
                        "action": {"type": "observe", "target": "well", "location": "well"},
                        "dialogue": None, "goal_progress": "none", "cooperation_intent": "medium",
                    })})()})()
                ]
                self.usage = type("U", (), {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})()
            def model_dump(self) -> dict[str, Any]:
                return {}

        class FakeRouter:
            def __init__(self) -> None:
                self.last_metadata: dict[str, Any] = {}
            async def acompletion(self, **kwargs: Any) -> FakeResponse:
                self.last_metadata = kwargs.get("metadata", {})
                return FakeResponse()

        client = LLMClient()
        fake_router = FakeRouter()
        client.router = fake_router  # type: ignore[assignment]

        await client.generate_structured(
            LLMRequest(
                role="agent",
                messages=[{"role": "system", "content": "test"}],
                response_format=AgentDecision,
                metadata={"experiment_id": "exp-42", "agent_name": "The Intern"},
            )
        )
        assert fake_router.last_metadata["session_id"] == "exp-42"
        assert fake_router.last_metadata["trace_user_id"] == "The Intern"

    @pytest.mark.asyncio
    async def test_trace_user_id_falls_back_to_role(self) -> None:
        import json
        from typing import Any
        from app.llm.client import LLMClient
        from app.llm.models import LLMRequest
        from app.schemas.agent_decision import AgentDecision

        class FakeResponse:
            def __init__(self) -> None:
                self.model = "openai/gpt-4o-mini"
                self.choices = [
                    type("C", (), {"message": type("M", (), {"content": json.dumps({
                        "inner_thought": "ok", "suspicion": None,
                        "action": {"type": "observe", "target": "well", "location": "well"},
                        "dialogue": None, "goal_progress": "none", "cooperation_intent": "medium",
                    })})()})()
                ]
                self.usage = type("U", (), {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})()
            def model_dump(self) -> dict[str, Any]:
                return {}

        class FakeRouter:
            def __init__(self) -> None:
                self.last_metadata: dict[str, Any] = {}
            async def acompletion(self, **kwargs: Any) -> FakeResponse:
                self.last_metadata = kwargs.get("metadata", {})
                return FakeResponse()

        client = LLMClient()
        fake_router = FakeRouter()
        client.router = fake_router  # type: ignore[assignment]

        await client.generate_structured(
            LLMRequest(
                role="gm",
                messages=[{"role": "system", "content": "test"}],
                response_format=AgentDecision,
                metadata={"experiment_id": "exp-42"},
            )
        )
        assert fake_router.last_metadata["session_id"] == "exp-42"
        assert fake_router.last_metadata["trace_user_id"] == "gm"
```

**Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestSessionAndUserMetadata -v`
Expected: FAIL — `session_id` and `trace_user_id` keys not in metadata

**Step 3: Add session_id and trace_user_id to metadata assembly**

In `backend/app/llm/client.py`, update the metadata block to:

```python
        metadata = {
            **request.metadata,
            **get_trace_context(),
            "generation_name": request.generation_name or request.role,
            "session_id": request.metadata.get("experiment_id", ""),
            "trace_user_id": request.metadata.get("agent_name", request.role),
        }
```

**Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_langfuse.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/app/llm/client.py backend/tests/test_langfuse.py
git commit -m "feat(langfuse): add session_id and trace_user_id to LLM metadata"
```

---

### Task 4: Set generation_name at all call sites

**Files:**
- Modify: `backend/app/gm/service.py:23-27`
- Modify: `backend/app/agents/brain.py:61-73`
- Modify: `backend/app/llm/service.py:75-112` (classify_memory_event)
- Modify: `backend/app/llm/service.py:118-162` (consolidate_memory_events)
- Modify: `backend/app/llm/service.py:164-202` (consolidate_relationship_memory)
- Test: `backend/tests/test_langfuse.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_langfuse.py`:

```python
class TestCallSiteGenerationNames:
    def test_gm_service_passes_generation_name(self) -> None:
        """GMService.generate_plan should pass generation_name='gm-plan'."""
        from app.gm.service import GMService
        from app.gm import GMPlanningContext, get_preset_arc
        from app.world import build_default_world_state
        from unittest.mock import AsyncMock, MagicMock

        captured_requests: list = []

        class CapturingLLMService:
            async def generate_gm_plan(self, **kwargs):
                captured_requests.append(kwargs)
                raise RuntimeError("stop here")

        svc = GMService(llm_service=CapturingLLMService())  # type: ignore[arg-type]
        ctx = GMPlanningContext(
            experiment_id="exp-1",
            round_number=1,
            total_rounds=15,
            arc=get_preset_arc("slow_burn"),
            world_state=build_default_world_state(),
        )
        import asyncio
        try:
            asyncio.get_event_loop().run_until_complete(svc.generate_plan(ctx))
        except RuntimeError:
            pass
        # GMService catches exceptions and falls back, so check if captured
        if captured_requests:
            assert captured_requests[0].get("metadata", {}).get("generation_name") == "gm-plan"
```

**Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestCallSiteGenerationNames -v`
Expected: FAIL — `generation_name` key not in metadata

**Step 3: Update all call sites**

**`backend/app/gm/service.py`** — In `generate_plan`, add `generation_name` to metadata:

```python
            result = await self.llm_service.generate_gm_plan(
                messages=[
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": prompt.user_prompt},
                ],
                response_format=GMPlanData,
                metadata={
                    "experiment_id": context.experiment_id,
                    "round_number": context.round_number,
                    "generation_name": "gm-plan",
                },
                model_override=None,
            )
```

**`backend/app/agents/brain.py`** — In `decide`, add `generation_name` and `agent_name` to metadata:

```python
            result = await self.llm_service.generate_agent_decision(
                messages=[
                    {"role": "system", "content": "Return a structured agent decision."},
                    {"role": "user", "content": prompt},
                ],
                response_format=AgentDecision,
                metadata={
                    "experiment_id": context.experiment_id,
                    "agent_id": context.agent_id,
                    "agent_name": context.name,
                    "round_number": context.world_state.round_number,
                    "generation_name": f"agent:{context.name}",
                },
                model_override=None,
            )
```

**`backend/app/llm/service.py`** — Update `generate_gm_plan` and `generate_agent_decision` to pass `generation_name` from metadata through to `LLMRequest`:

In `generate_gm_plan`:
```python
        return await self.client.generate_structured(
            LLMRequest(
                role="gm",
                messages=messages,
                response_format=response_format,
                metadata=metadata or {},
                model_override=model_override,
                generation_name=(metadata or {}).get("generation_name"),
            )
        )
```

In `generate_agent_decision`:
```python
        return await self.client.generate_structured(
            LLMRequest(
                role="agent",
                messages=messages,
                response_format=response_format,
                metadata=metadata or {},
                model_override=model_override,
                generation_name=(metadata or {}).get("generation_name"),
            )
        )
```

Update memory methods in `LLMService`:

`classify_memory_event` — update metadata dict and add `generation_name` to `LLMRequest`:
```python
                metadata={"memory_classifier": True, "round_number": event.round_number},
```
becomes:
```python
                metadata={"memory_classifier": True, "round_number": event.round_number},
                generation_name=f"memory:classify",
```

`consolidate_memory_events` — add `generation_name`:
```python
                generation_name=f"memory:consolidate",
```

`consolidate_relationship_memory` — add `generation_name`:
```python
                generation_name=f"memory:relationship",
```

**Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_langfuse.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `cd backend && python -m pytest -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add backend/app/gm/service.py backend/app/agents/brain.py backend/app/llm/service.py backend/tests/test_langfuse.py
git commit -m "feat(langfuse): set descriptive generation_name at all LLM call sites"
```

---

### Task 5: Enrich memory call metadata with agent context

**Files:**
- Modify: `backend/app/llm/service.py:75-202`
- Modify: `backend/app/engine/service.py:506-546` (`_build_night_reflection`)
- Test: `backend/tests/test_langfuse.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_langfuse.py`:

```python
class TestMemoryMetadataEnrichment:
    def test_classify_memory_includes_agent_context(self) -> None:
        """classify_memory_event should accept and forward experiment_id, agent_id, agent_name."""
        from app.llm.service import LLMService
        from app.llm.models import LLMRequest
        from unittest.mock import AsyncMock

        captured: list[LLMRequest] = []

        class CapturingClient:
            tracker = type("T", (), {"record": lambda *a, **kw: None})()
            async def generate_structured(self, request: LLMRequest):
                captured.append(request)
                raise RuntimeError("stop")

        svc = LLMService(client=CapturingClient())  # type: ignore[arg-type]
        from app.agents.models import MemoryEvent
        event = MemoryEvent(round_number=1, summary="test", emotional_charge=3, tags=[])

        import asyncio
        try:
            asyncio.get_event_loop().run_until_complete(
                svc.classify_memory_event(
                    event=event, goal=None, suspicion_level=10.0,
                    recent_key_memories=[],
                    experiment_id="exp-1", agent_id="a-1", agent_name="The Intern",
                )
            )
        except RuntimeError:
            pass

        assert len(captured) == 1
        assert captured[0].metadata["experiment_id"] == "exp-1"
        assert captured[0].metadata["agent_id"] == "a-1"
        assert captured[0].metadata["agent_name"] == "The Intern"
        assert captured[0].generation_name == "memory:classify:The Intern"
```

**Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestMemoryMetadataEnrichment -v`
Expected: FAIL — `classify_memory_event` doesn't accept `experiment_id`, `agent_id`, `agent_name` kwargs

**Step 3: Add agent context params to memory methods**

In `backend/app/llm/service.py`, update all three memory methods to accept and forward agent context:

`classify_memory_event`:
```python
    async def classify_memory_event(
        self,
        *,
        event: MemoryEvent,
        goal: SecretGoal | None,
        suspicion_level: float,
        recent_key_memories: list[KeyMemory],
        experiment_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
    ) -> MemoryPromotionDecision:
        result = await self.client.generate_structured(
            LLMRequest(
                role="memory",
                messages=[...],  # unchanged
                response_format=MemoryPromotionDecision,
                metadata={
                    "memory_classifier": True,
                    "round_number": event.round_number,
                    "experiment_id": experiment_id or "",
                    "agent_id": agent_id or "",
                    "agent_name": agent_name or "",
                },
                generation_name=f"memory:classify:{agent_name}" if agent_name else "memory:classify",
            )
        )
```

`consolidate_memory_events` — same pattern with `generation_name=f"memory:consolidate:{agent_name}"`.

`consolidate_relationship_memory` — same pattern with `generation_name=f"memory:relationship:{agent_name}"`, also add `round_number` param.

Then update `backend/app/agents/service.py` to forward these params (check the method signatures and pass through).

Then update `backend/app/engine/service.py` `_build_night_reflection` to pass `experiment_id`, `agent_id`, `agent_name` through the agent service calls. The engine has access to `state.experiment_id` and `agent.agent_id`/`agent.name`.

**Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_langfuse.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `cd backend && python -m pytest -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add backend/app/llm/service.py backend/app/agents/service.py backend/app/engine/service.py backend/tests/test_langfuse.py
git commit -m "feat(langfuse): enrich memory LLM calls with agent context metadata"
```

---

### Task 6: Add tags to metadata

**Files:**
- Modify: `backend/app/llm/client.py:70-84`
- Modify: `backend/app/gm/service.py:23-27`
- Modify: `backend/app/agents/brain.py:61-73`
- Test: `backend/tests/test_langfuse.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_langfuse.py`:

```python
class TestTagsInMetadata:
    @pytest.mark.asyncio
    async def test_tags_forwarded_to_litellm_metadata(self) -> None:
        import json
        from typing import Any
        from app.llm.client import LLMClient
        from app.llm.models import LLMRequest
        from app.schemas.agent_decision import AgentDecision

        class FakeResponse:
            def __init__(self) -> None:
                self.model = "openai/gpt-4o-mini"
                self.choices = [
                    type("C", (), {"message": type("M", (), {"content": json.dumps({
                        "inner_thought": "ok", "suspicion": None,
                        "action": {"type": "observe", "target": "well", "location": "well"},
                        "dialogue": None, "goal_progress": "none", "cooperation_intent": "medium",
                    })})()})()
                ]
                self.usage = type("U", (), {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})()
            def model_dump(self) -> dict[str, Any]:
                return {}

        class FakeRouter:
            def __init__(self) -> None:
                self.last_metadata: dict[str, Any] = {}
            async def acompletion(self, **kwargs: Any) -> FakeResponse:
                self.last_metadata = kwargs.get("metadata", {})
                return FakeResponse()

        client = LLMClient()
        fake_router = FakeRouter()
        client.router = fake_router  # type: ignore[assignment]

        await client.generate_structured(
            LLMRequest(
                role="agent",
                messages=[{"role": "system", "content": "test"}],
                response_format=AgentDecision,
                metadata={
                    "tags": ["role:agent", "phase:morning", "archetype:resource_control"],
                },
            )
        )
        assert fake_router.last_metadata["tags"] == ["role:agent", "phase:morning", "archetype:resource_control"]
```

**Step 2: Run test to verify behavior**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestTagsInMetadata -v`
Expected: Should PASS already since tags are passed through via `**request.metadata` spread. If it does pass, this confirms tags flow through. If not, add explicit `tags` handling.

**Step 3: Add tags at call sites**

In `backend/app/agents/brain.py`, add tags to the metadata dict:
```python
                metadata={
                    "experiment_id": context.experiment_id,
                    "agent_id": context.agent_id,
                    "agent_name": context.name,
                    "round_number": context.world_state.round_number,
                    "generation_name": f"agent:{context.name}",
                    "tags": [
                        f"role:agent",
                        f"archetype:{context.goal.archetype}",
                    ],
                },
```

In `backend/app/gm/service.py`, add tags:
```python
                metadata={
                    "experiment_id": context.experiment_id,
                    "round_number": context.round_number,
                    "generation_name": "gm-plan",
                    "tags": ["role:gm"],
                },
```

Tags for arc/act/phase will be added at the engine level in the trace metadata (Task 8).

**Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_langfuse.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/app/llm/client.py backend/app/gm/service.py backend/app/agents/brain.py backend/tests/test_langfuse.py
git commit -m "feat(langfuse): add namespace:value tags to LLM call metadata"
```

---

### Task 7: Add `record_scores()` to langfuse.py

**Files:**
- Modify: `backend/app/core/langfuse.py`
- Test: `backend/tests/test_langfuse.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_langfuse.py`:

```python
class TestRecordScores:
    def test_record_scores_noop_when_no_client(self) -> None:
        from app.core import langfuse
        langfuse._client = None
        # Should not raise
        langfuse.record_scores(trace_id="t-1", scores={"cooperation": 0.5})

    def test_record_scores_calls_score_api(self) -> None:
        from app.core import langfuse
        mock_client = MagicMock()
        langfuse._client = mock_client
        try:
            langfuse.record_scores(
                trace_id="t-1",
                scores={"cooperation_ratio": 0.6, "threat_level": 80.0},
            )
            assert mock_client.score.call_count == 2
            calls = mock_client.score.call_args_list
            score_names = {c.kwargs["name"] for c in calls}
            assert score_names == {"cooperation_ratio", "threat_level"}
            for c in calls:
                assert c.kwargs["trace_id"] == "t-1"
        finally:
            langfuse._client = None

    def test_record_scores_swallows_exceptions(self) -> None:
        from app.core import langfuse
        mock_client = MagicMock()
        mock_client.score.side_effect = RuntimeError("boom")
        langfuse._client = mock_client
        try:
            # Should not raise
            langfuse.record_scores(trace_id="t-1", scores={"test": 1.0})
        finally:
            langfuse._client = None
```

**Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestRecordScores -v`
Expected: FAIL — `record_scores` does not exist

**Step 3: Add `record_scores()` to langfuse.py**

In `backend/app/core/langfuse.py`, add after the `log_event` function:

```python
def record_scores(*, trace_id: str, scores: dict[str, float]) -> None:
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
            logger.warning("langfuse score failed", name=name, exc_info=True)
```

**Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestRecordScores -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/core/langfuse.py backend/tests/test_langfuse.py
git commit -m "feat(langfuse): add record_scores() helper for round-level metrics"
```

---

### Task 8: Add scores and trace I/O to `run_round()`

**Files:**
- Modify: `backend/app/engine/service.py:129-137` (trace creation) and `234-244` (trace update)
- Test: `backend/tests/test_langfuse.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_langfuse.py`:

```python
class TestRoundScoresAndTraceIO:
    @pytest.mark.asyncio
    async def test_round_trace_includes_input_output(self) -> None:
        from app.core import langfuse as lf_module

        trace_calls: list[dict] = []
        mock_trace_obj = MagicMock()
        mock_trace_obj.id = "trace-io"
        mock_trace_obj.span.return_value = MagicMock(id="span-io")

        original_trace = lf_module.trace

        def fake_trace(*, name, session_id, **kwargs):
            trace_calls.append({"name": name, "session_id": session_id, **kwargs})
            return mock_trace_obj

        lf_module.trace = fake_trace  # type: ignore[assignment]
        try:
            engine, state = _build_engine_and_state()
            await engine.run_round(state)

            assert len(trace_calls) == 1
            call = trace_calls[0]
            assert "input" in call
            assert "round" in call["input"]
        finally:
            lf_module.trace = original_trace  # type: ignore[assignment]

    @pytest.mark.asyncio
    async def test_round_scores_recorded(self) -> None:
        from app.core import langfuse as lf_module

        mock_trace_obj = MagicMock()
        mock_trace_obj.id = "trace-scores"
        mock_trace_obj.span.return_value = MagicMock(id="span-scores")

        original_trace = lf_module.trace
        original_record = lf_module.record_scores
        score_calls: list[dict] = []

        def fake_record(*, trace_id, scores):
            score_calls.append({"trace_id": trace_id, "scores": scores})

        lf_module.trace = lambda **kw: mock_trace_obj  # type: ignore[assignment]
        lf_module.record_scores = fake_record  # type: ignore[assignment]
        try:
            engine, state = _build_engine_and_state()
            await engine.run_round(state)

            assert len(score_calls) == 1
            assert score_calls[0]["trace_id"] == "trace-scores"
            scores = score_calls[0]["scores"]
            assert "cooperation_ratio" in scores
            assert "threat_level" in scores
        finally:
            lf_module.trace = original_trace  # type: ignore[assignment]
            lf_module.record_scores = original_record  # type: ignore[assignment]
```

**Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_langfuse.py::TestRoundScoresAndTraceIO -v`
Expected: FAIL — trace not called with `input`, `record_scores` not called

**Step 3: Update `run_round()` in engine/service.py**

Update the trace creation (around line 129) to include `input`:

```python
        trace = lf.trace(
            name=f"round-{round_number}",
            session_id=state.experiment_id,
            input={
                "round": round_number,
                "arc": state.arc.name,
                "act": state.arc.current_act(round_number, state.total_rounds).name
                if hasattr(state.arc, "current_act")
                else "",
                "resources": state.world_state.resources.model_dump(),
                "threat_level": state.world_state.threat_level,
                "agent_count": len(state.agents),
            },
            metadata={
                "experiment_id": state.experiment_id,
                "round_number": round_number,
                "total_rounds": state.total_rounds,
                "status": state.status,
                "tags": [
                    f"arc:{state.arc.name}",
                ],
            },
        )
```

Update the trace update section (around line 234) to include `output` and call `record_scores`:

```python
        if trace is not None:
            try:
                trace.update(
                    output={
                        "status": state.status,
                        "cooperation_ratio": round(cooperation_ratio, 3),
                        "threat_level": round(state.world_state.threat_level, 2),
                        "event_count": sum(
                            len(pr.events)
                            for pr in [
                                gm_result, dawn_result, morning_result,
                                midday_result, afternoon_result, night_result,
                            ]
                        ),
                    },
                    metadata={
                        "status": state.status,
                        "cooperation_ratio": cooperation_ratio,
                        "threat_level": state.world_state.threat_level,
                    },
                )
            except Exception:
                log.warning("langfuse trace.update failed", exc_info=True)

            lf.record_scores(
                trace_id=self._obj_id(trace),
                scores={
                    "cooperation_ratio": round(cooperation_ratio, 3),
                    "threat_level": round(state.world_state.threat_level, 2),
                },
            )
```

**Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_langfuse.py -v`
Expected: All PASS

**Step 5: Run full test suite**

Run: `cd backend && python -m pytest -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add backend/app/engine/service.py backend/tests/test_langfuse.py
git commit -m "feat(langfuse): add round scores, trace input/output, and arc tags"
```

---

### Task 9: Final verification — run all tests and lint

**Step 1: Run full test suite**

Run: `cd backend && python -m pytest -v`
Expected: All PASS

**Step 2: Run linter**

Run: `cd backend && python -m ruff check .`
Expected: No errors

**Step 3: Run type checker**

Run: `cd backend && python -m mypy app/ --ignore-missing-imports`
Expected: No new errors

**Step 4: Commit any fixes**

If lint/type fixes needed, commit them:
```bash
git add -u
git commit -m "chore: fix lint and type issues from langfuse observability changes"
```

---

## Summary of Changes

| File | Changes |
|------|---------|
| `backend/app/llm/models.py` | Add `generation_name: str \| None` to `LLMRequest` |
| `backend/app/llm/client.py` | Use `generation_name`, add `session_id`/`trace_user_id`, debug logging |
| `backend/app/llm/service.py` | Add agent context params to memory methods, set `generation_name` |
| `backend/app/gm/service.py` | Add `generation_name="gm-plan"` and tags |
| `backend/app/agents/brain.py` | Add `generation_name=f"agent:{name}"`, `agent_name`, tags |
| `backend/app/engine/service.py` | Trace I/O, round scores, arc tags, pass agent context to memory |
| `backend/app/core/langfuse.py` | Add `record_scores()` helper |
| `backend/tests/test_langfuse.py` | Tests for all new functionality |
