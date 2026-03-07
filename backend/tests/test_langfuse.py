"""Tests for Langfuse configuration and lifecycle (S3.6 sections 1, 3 + 5)."""

from unittest.mock import MagicMock, patch

import pytest

import app.llm.client as llm_client_module
import app.llm.config as llm_config_module
from app.core.config import Settings


# --- Section 3: Configuration ---


class TestLangfuseSettings:
    def test_langfuse_fields_default_to_none(self) -> None:
        settings = Settings()

        assert settings.langfuse_public_key is None
        assert settings.langfuse_secret_key is None
        assert settings.langfuse_host is None

    def test_langfuse_enabled_when_both_keys_set(self) -> None:
        settings = Settings(
            langfuse_public_key="pk-lf-test",
            langfuse_secret_key="sk-lf-test",
        )

        assert settings.langfuse_enabled is True

    def test_langfuse_disabled_when_public_key_missing(self) -> None:
        settings = Settings(langfuse_secret_key="sk-lf-test")

        assert settings.langfuse_enabled is False

    def test_langfuse_disabled_when_secret_key_missing(self) -> None:
        settings = Settings(langfuse_public_key="pk-lf-test")

        assert settings.langfuse_enabled is False

    def test_langfuse_disabled_when_no_keys(self) -> None:
        settings = Settings()

        assert settings.langfuse_enabled is False

    def test_langfuse_host_configurable(self) -> None:
        settings = Settings(
            langfuse_public_key="pk-lf-test",
            langfuse_secret_key="sk-lf-test",
            langfuse_host="https://langfuse.example.com",
        )

        assert settings.langfuse_host == "https://langfuse.example.com"


# --- Section 5: Graceful Lifecycle ---


class TestLangfuseLifecycle:
    def test_init_returns_none_when_disabled(self) -> None:
        from app.core import langfuse

        langfuse._client = None
        langfuse.init()

        assert langfuse._client is None

    def test_init_creates_client_when_enabled(self) -> None:
        import sys

        from app.core import langfuse

        langfuse._client = None
        mock_instance = MagicMock()
        mock_langfuse_cls = MagicMock(return_value=mock_instance)
        mock_module = MagicMock(Langfuse=mock_langfuse_cls)

        # Remove cached langfuse module so the local import inside init() picks up our mock
        saved = sys.modules.pop("langfuse", None)
        sys.modules["langfuse"] = mock_module
        try:
            with patch("app.core.langfuse.get_settings") as mock_settings:
                mock_settings.return_value = Settings(
                    langfuse_public_key="pk-lf-test",
                    langfuse_secret_key="sk-lf-test",
                    langfuse_host="https://cloud.langfuse.com",
                )
                langfuse.init()

                mock_langfuse_cls.assert_called_once_with(
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                    host="https://cloud.langfuse.com",
                )
                assert langfuse._client is mock_instance
        finally:
            if saved is not None:
                sys.modules["langfuse"] = saved
            else:
                sys.modules.pop("langfuse", None)
            langfuse._client = None

    def test_shutdown_flushes_client(self) -> None:
        from app.core import langfuse

        mock_client = MagicMock()
        langfuse._client = mock_client
        try:
            langfuse.shutdown()
            mock_client.flush.assert_called_once()
        finally:
            langfuse._client = None

    def test_shutdown_noop_when_no_client(self) -> None:
        from app.core import langfuse

        langfuse._client = None
        langfuse.shutdown()  # should not raise

    def test_shutdown_resets_client(self) -> None:
        from app.core import langfuse

        mock_client = MagicMock()
        langfuse._client = mock_client

        langfuse.shutdown()

        assert langfuse._client is None

    def test_tracing_errors_do_not_propagate(self) -> None:
        from app.core import langfuse

        mock_client = MagicMock()
        mock_client.trace.side_effect = RuntimeError("langfuse down")
        langfuse._client = mock_client
        try:
            # Should not raise — fire-and-forget
            result = langfuse.trace(name="test-trace", session_id="exp-1")
            assert result is None
        finally:
            langfuse._client = None


# --- Section 1: litellm Callback Integration ---


class TestLitellmCallbackIntegration:
    def test_langfuse_callback_registered_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import litellm

        settings = Settings(
            langfuse_public_key="pk-lf-test",
            langfuse_secret_key="sk-lf-test",
        )
        monkeypatch.setattr(llm_client_module, "get_settings", lambda: settings)
        monkeypatch.setattr(llm_config_module, "get_settings", lambda: settings)
        # Clear any existing callbacks
        monkeypatch.setattr(litellm, "success_callback", [])
        monkeypatch.setattr(litellm, "failure_callback", [])

        from app.llm import LLMClient

        LLMClient()

        assert "langfuse" in litellm.success_callback
        assert "langfuse" in litellm.failure_callback

    def test_langfuse_callback_not_registered_when_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import litellm

        settings = Settings()
        monkeypatch.setattr(llm_client_module, "get_settings", lambda: settings)
        monkeypatch.setattr(llm_config_module, "get_settings", lambda: settings)
        monkeypatch.setattr(litellm, "success_callback", [])
        monkeypatch.setattr(litellm, "failure_callback", [])

        from app.llm import LLMClient

        LLMClient()

        assert "langfuse" not in litellm.success_callback
        assert "langfuse" not in litellm.failure_callback


# --- Section 2: Trace Hierarchy ---


class TestLangfuseSpanHelper:
    def test_span_returns_none_when_no_client(self) -> None:
        from app.core import langfuse

        langfuse._client = None
        result = langfuse.span(name="test")
        assert result is None

    def test_span_delegates_to_trace_span(self) -> None:
        from app.core import langfuse

        mock_trace = MagicMock()
        mock_trace.span.return_value = MagicMock(id="span-1")

        result = langfuse.span(
            name="gm_plan",
            trace=mock_trace,
            metadata={"round": 1},
        )

        mock_trace.span.assert_called_once_with(
            name="gm_plan",
            metadata={"round": 1},
        )
        assert result is not None

    def test_span_errors_do_not_propagate(self) -> None:
        from app.core import langfuse

        mock_trace = MagicMock()
        mock_trace.span.side_effect = RuntimeError("boom")

        result = langfuse.span(name="test", trace=mock_trace)
        assert result is None


class TestTraceHierarchyInEngine:
    @pytest.mark.asyncio
    async def test_run_round_creates_langfuse_trace(self) -> None:
        from app.core import langfuse as lf_module

        mock_trace_obj = MagicMock()
        mock_trace_obj.id = "trace-123"
        mock_trace_obj.span.return_value = MagicMock(id="span-456")

        original_trace = lf_module.trace
        calls: list[dict[str, object]] = []

        def fake_trace(*, name: str, session_id: str, **kwargs: object) -> object:
            calls.append({"name": name, "session_id": session_id, **kwargs})
            return mock_trace_obj

        lf_module.trace = fake_trace  # type: ignore[assignment]
        try:
            engine, state = _build_engine_and_state()
            await engine.run_round(state)

            assert len(calls) == 1
            assert calls[0]["name"] == "round-1"
            assert calls[0]["session_id"] == "exp-1"
        finally:
            lf_module.trace = original_trace  # type: ignore[assignment]

    @pytest.mark.asyncio
    async def test_run_round_creates_phase_spans(self) -> None:
        from app.core import langfuse as lf_module

        mock_trace_obj = MagicMock()
        mock_trace_obj.id = "trace-123"
        span_names: list[str] = []
        mock_span = MagicMock(id="span-456")

        def capture_span(name: str, **kwargs: object) -> MagicMock:
            span_names.append(name)
            return mock_span

        mock_trace_obj.span.side_effect = capture_span

        original_trace = lf_module.trace

        def fake_trace(*, name: str, session_id: str, **kwargs: object) -> object:
            return mock_trace_obj

        lf_module.trace = fake_trace  # type: ignore[assignment]
        try:
            engine, state = _build_engine_and_state()
            await engine.run_round(state)

            assert "gm_plan" in span_names
            assert "morning" in span_names
            assert "afternoon" in span_names
            assert "night" in span_names
            assert "midday" not in span_names  # no LLM calls in midday
        finally:
            lf_module.trace = original_trace  # type: ignore[assignment]


class TestTraceContextPropagation:
    def test_set_and_get_trace_context(self) -> None:
        from app.core.langfuse import get_trace_context, set_trace_context

        token = set_trace_context(trace_id="t-1", span_id="s-1")
        ctx = get_trace_context()
        assert ctx == {"trace_id": "t-1", "parent_observation_id": "s-1"}

        from app.core.langfuse import _trace_context

        _trace_context.reset(token)

    def test_get_trace_context_returns_empty_when_unset(self) -> None:
        from app.core.langfuse import get_trace_context

        ctx = get_trace_context()
        assert ctx == {}

    @pytest.mark.asyncio
    async def test_llm_client_merges_trace_context_into_metadata(self) -> None:
        """When trace context is set, generate_structured should include it in the litellm call."""
        import json
        from typing import Any
        from app.core.langfuse import set_trace_context, _trace_context
        from app.llm.client import LLMClient
        from app.llm.models import LLMRequest
        from app.schemas.agent_decision import AgentDecision

        class FakeResponse:
            def __init__(self) -> None:
                self.model = "openai/gpt-4o-mini"
                self.choices = [
                    type(
                        "C",
                        (),
                        {
                            "message": type(
                                "M",
                                (),
                                {
                                    "content": json.dumps(
                                        {
                                            "inner_thought": "ok",
                                            "suspicion": None,
                                            "action": {
                                                "type": "observe",
                                                "target": "well",
                                                "location": "well",
                                            },
                                            "dialogue": None,
                                            "goal_progress": "none",
                                            "cooperation_intent": "medium",
                                        }
                                    )
                                },
                            )()
                        },
                    )
                ]
                self.usage = type(
                    "U",
                    (),
                    {
                        "prompt_tokens": 10,
                        "completion_tokens": 5,
                        "total_tokens": 15,
                    },
                )()

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

        token = set_trace_context(trace_id="t-abc", span_id="s-def")
        try:
            await client.generate_structured(
                LLMRequest(
                    role="agent",
                    messages=[{"role": "system", "content": "test"}],
                    response_format=AgentDecision,
                    metadata={"experiment_id": "exp-1"},
                )
            )
            assert fake_router.last_metadata["trace_id"] == "t-abc"
            assert fake_router.last_metadata["parent_observation_id"] == "s-def"
            assert fake_router.last_metadata["experiment_id"] == "exp-1"
        finally:
            _trace_context.reset(token)

    @pytest.mark.asyncio
    async def test_engine_sets_trace_context_for_agent_decisions(self) -> None:
        """Engine should set trace context so agent LLM calls get trace_id/span_id."""
        from app.core import langfuse as lf_module

        mock_trace_obj = MagicMock()
        mock_trace_obj.id = "trace-999"
        mock_span = MagicMock(id="span-morning")
        mock_trace_obj.span.return_value = mock_span

        original_trace = lf_module.trace
        original_span = lf_module.span

        captured_contexts: list[dict[str, str]] = []
        original_set = lf_module.set_trace_context

        def tracking_set(trace_id: str, span_id: str) -> object:
            token = original_set(trace_id=trace_id, span_id=span_id)
            captured_contexts.append({"trace_id": trace_id, "span_id": span_id})
            return token

        lf_module.trace = lambda **kw: mock_trace_obj  # type: ignore[assignment]
        lf_module.span = lambda **kw: mock_span  # type: ignore[assignment]
        lf_module.set_trace_context = tracking_set  # type: ignore[assignment]
        try:
            engine, state = _build_engine_and_state()
            await engine.run_round(state)

            trace_ids = [c["trace_id"] for c in captured_contexts]
            assert "trace-999" in trace_ids
        finally:
            lf_module.trace = original_trace  # type: ignore[assignment]
            lf_module.span = original_span  # type: ignore[assignment]
            lf_module.set_trace_context = original_set  # type: ignore[assignment]


class TestAgentAndMemorySpans:
    """AC 2.4: Agent decision spans include agent_id and agent_name.
    AC 2.5: Memory operation spans nested under night phase span."""

    @pytest.mark.asyncio
    async def test_agent_decision_spans_include_agent_metadata(self) -> None:
        from app.core import langfuse as lf_module

        mock_trace_obj = MagicMock()
        mock_trace_obj.id = "trace-a"
        span_calls: list[dict[str, object]] = []

        def make_capturing_mock(name: str) -> MagicMock:
            m = MagicMock(id=f"span-{name}")
            m.span.side_effect = lambda name, **kw: (
                span_calls.append({"name": name, **kw}) or make_capturing_mock(name)
            )
            return m

        def capture_span(name: str, **kwargs: object) -> MagicMock:
            span_calls.append({"name": name, **kwargs})
            return make_capturing_mock(name)

        mock_trace_obj.span.side_effect = capture_span
        original_trace = lf_module.trace

        lf_module.trace = lambda **kw: mock_trace_obj  # type: ignore[assignment]
        try:
            engine, state = _build_engine_and_state()
            await engine.run_round(state)

            agent_spans = [
                c
                for c in span_calls
                if isinstance(c.get("name"), str) and c["name"].startswith("agent:")
            ]
            assert len(agent_spans) >= 2  # at least one per agent
            for s in agent_spans:
                meta = s.get("metadata", {})
                assert "agent_id" in meta  # type: ignore[operator]
                assert "agent_name" in meta  # type: ignore[operator]
        finally:
            lf_module.trace = original_trace  # type: ignore[assignment]

    @pytest.mark.asyncio
    async def test_memory_spans_nested_under_night(self) -> None:
        from app.core import langfuse as lf_module

        mock_trace_obj = MagicMock()
        mock_trace_obj.id = "trace-b"
        span_calls: list[dict[str, object]] = []
        night_span = MagicMock(id="span-night")
        night_span_child_calls: list[dict[str, object]] = []

        def capture_span(name: str, **kwargs: object) -> MagicMock:
            span_calls.append({"name": name, **kwargs})
            if name == "night":
                return night_span
            return MagicMock(id=f"span-{name}")

        def capture_night_child(name: str, **kwargs: object) -> MagicMock:
            night_span_child_calls.append({"name": name, **kwargs})
            return MagicMock(id=f"child-{name}")

        mock_trace_obj.span.side_effect = capture_span
        night_span.span.side_effect = capture_night_child
        original_trace = lf_module.trace

        lf_module.trace = lambda **kw: mock_trace_obj  # type: ignore[assignment]
        try:
            engine, state = _build_engine_and_state()
            await engine.run_round(state)

            memory_names = [c["name"] for c in night_span_child_calls]
            assert any("memory" in str(n) or "consolidat" in str(n) for n in memory_names)
        finally:
            lf_module.trace = original_trace  # type: ignore[assignment]


class TestRepairAndStatusMetadata:
    """AC 4.3: Failed/repaired JSON logged as span events.
    AC 4.4: Experiment status set as trace metadata on round completion."""

    @pytest.mark.asyncio
    async def test_repair_attempt_logged_as_span_event(self) -> None:
        """When JSON repair occurs, a span event should be recorded."""
        import json
        from typing import Any
        from app.core.langfuse import set_trace_context, _trace_context

        calls: list[dict[str, object]] = []

        def mock_log_event(*, name: str, metadata: object = None) -> None:
            calls.append({"name": name, "metadata": metadata})

        from app.llm.client import LLMClient
        from app.llm.models import LLMRequest
        from app.schemas.agent_decision import AgentDecision

        class FakeResponse:
            def __init__(self, content: str) -> None:
                self.model = "openai/gpt-4o-mini"
                self.choices = [type("C", (), {"message": type("M", (), {"content": content})()})()]
                self.usage = type(
                    "U", (), {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
                )()

            def model_dump(self) -> dict[str, Any]:
                return {}

        good_json = json.dumps(
            {
                "inner_thought": "ok",
                "suspicion": None,
                "action": {"type": "observe", "target": "well", "location": "well"},
                "dialogue": None,
                "goal_progress": "none",
                "cooperation_intent": "medium",
            }
        )

        class FakeRouter:
            def __init__(self) -> None:
                self.call_count = 0

            async def acompletion(self, **kwargs: Any) -> FakeResponse:
                self.call_count += 1
                if self.call_count == 1:
                    return FakeResponse("not-valid-json")
                return FakeResponse(good_json)

        client = LLMClient()
        client.router = FakeRouter()  # type: ignore[assignment]
        token = set_trace_context(trace_id="t-1", span_id="s-1")
        try:
            with patch("app.llm.client.log_event", side_effect=mock_log_event):
                await client.generate_structured(
                    LLMRequest(
                        role="agent",
                        messages=[{"role": "system", "content": "test"}],
                        response_format=AgentDecision,
                        metadata={},
                    )
                )
            assert len(calls) >= 1
            assert any("repair" in str(c["name"]).lower() for c in calls)
        finally:
            _trace_context.reset(token)

    @pytest.mark.asyncio
    async def test_experiment_status_set_on_trace_after_round(self) -> None:
        from app.core import langfuse as lf_module

        mock_trace_obj = MagicMock()
        mock_trace_obj.id = "trace-status"
        mock_trace_obj.span.return_value = MagicMock(id="span-x")
        update_calls: list[dict[str, object]] = []

        def capture_update(**kwargs: object) -> None:
            update_calls.append(kwargs)

        mock_trace_obj.update = capture_update
        original_trace = lf_module.trace

        lf_module.trace = lambda **kw: mock_trace_obj  # type: ignore[assignment]
        try:
            engine, state = _build_engine_and_state()
            await engine.run_round(state)

            assert len(update_calls) >= 1
            last_update = update_calls[-1]
            meta = last_update.get("metadata", {})
            assert "status" in meta  # type: ignore[operator]
        finally:
            lf_module.trace = original_trace  # type: ignore[assignment]


def _build_engine_and_state() -> tuple[object, object]:
    from app.agents.models import (
        AgentMemoryState,
        AgentTurnResult,
        PersonalityAxes,
        PersonalityProfile,
        SecretGoal,
    )
    from app.engine import EngineAgentState, SimulationEngine, SimulationState
    from app.gm import get_preset_arc
    from app.gm.models import GMPlanRecord, GMPlanningContext
    from app.gm.planner import generate_rule_based_plan
    from app.gm.service import GMService
    from app.schemas.agent_decision import AgentDecision, DecisionAction
    from app.world import build_default_world_state, resolve_spawn_tile
    from typing import cast

    class StubGMService(GMService):
        def __init__(self) -> None:
            pass

        async def generate_plan(self, context: GMPlanningContext) -> GMPlanRecord:
            plan = generate_rule_based_plan(context)
            return self.apply_plan(self.approve_plan(GMPlanRecord(plan=plan)))

    class StubAgentService:
        async def decide(self, context: object) -> AgentTurnResult:
            from app.agents.models import AgentContext

            ctx = cast(AgentContext, context)
            return AgentTurnResult(
                decision=AgentDecision(
                    inner_thought="stub",
                    suspicion=None,
                    action=DecisionAction(type="observe", target="well", location="well"),
                    dialogue=None,
                    goal_progress="none",
                    cooperation_intent="medium",
                ),
                updated_memory=ctx.memory,
                suspicion_level=ctx.suspicion_level,
                prompt="stub",
            )

        async def register_observation(self, memory: object, **kwargs: object) -> object:
            return memory

        def update_relationship(self, memory: object, **kwargs: object) -> object:
            return memory

        async def consolidate_memory(self, memory: object, **kwargs: object) -> object:
            return memory

        async def consolidate_relationship_memory(self, memory: object, **kwargs: object) -> object:
            return memory

    def make_agent(agent_id: str, name: str, loc: str) -> EngineAgentState:
        tx, ty = resolve_spawn_tile(loc)
        return EngineAgentState(
            agent_id=agent_id,
            name=name,
            personality=PersonalityProfile(
                axes=PersonalityAxes(
                    paranoia=50,
                    empathy=50,
                    dominance=50,
                    impulsiveness=50,
                    loyalty=50,
                    ambition=50,
                ),
                trait_tags=["guarded", "curious"],
                self_concept="I am here.",
            ),
            goal=SecretGoal(archetype="truth_revelation", text="Find the truth."),
            memory=AgentMemoryState(),
            location=loc,
            tile_x=tx,
            tile_y=ty,
            relationships={},
            llm_model="openai/gpt-4o-mini",
        )

    state = SimulationState(
        experiment_id="exp-1",
        experiment_name="Test",
        total_rounds=15,
        current_round=0,
        status="running",
        auto_approve=True,
        arc=get_preset_arc("slow_burn"),
        world_state=build_default_world_state(),
        agents=[
            make_agent("a1", "Mara", "well"),
            make_agent("a2", "Jon", "well"),
        ],
    )
    engine = SimulationEngine(
        gm_service=StubGMService(),
        agent_service=StubAgentService(),  # type: ignore[arg-type]
        random_seed=42,
    )
    return engine, state
