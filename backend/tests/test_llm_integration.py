from __future__ import annotations

import json
from typing import Any

import pytest

import app.llm.client as llm_client_module
import app.llm.config as llm_config_module
from app.core.config import Settings
from app.llm import LLMClient, get_default_model_configs
from app.llm.models import LLMUsage, LLMResult, UsageRecord
from app.llm.service import LLMService
from app.schemas.agent_decision import (
    AGENT_DECISION_MAX_TOKENS,
    AgentDecision,
)
from app.schemas.gm_plan import GMPlanRead


class _FakeUsage:
    def __init__(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = prompt_tokens + completion_tokens


class _FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str, finish_reason: str = "stop") -> None:
        self.message = _FakeMessage(content)
        self.finish_reason = finish_reason


class _FakeResponse:
    def __init__(self, model: str, content: str) -> None:
        self.model = model
        self.choices = [_FakeChoice(content)]
        self.usage = _FakeUsage(prompt_tokens=10, completion_tokens=5)

    def model_dump(self) -> dict[str, Any]:
        return {"model": self.model, "content": self.choices[0].message.content}


class _FakeRouter:
    def __init__(self, responses: list[_FakeResponse]) -> None:
        self.responses = responses
        self.calls: list[dict[str, Any]] = []

    async def acompletion(self, **kwargs: Any) -> _FakeResponse:
        self.calls.append(kwargs)
        return self.responses.pop(0)


class _FakeLLMClient:
    def __init__(self, result: LLMResult) -> None:
        self._result = result

    async def generate_structured(self, request: Any) -> LLMResult:
        return self._result


@pytest.mark.asyncio
async def test_defaults_include_gm_and_agent_configs() -> None:
    configs = get_default_model_configs()
    assert set(configs) == {"gm", "agent", "memory"}
    assert configs["gm"].primary_model
    assert configs["agent"].fallback_models
    assert configs["memory"].fallback_models


def test_router_model_list_includes_memory_model(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(
        memory_model="anthropic/claude-3-5-sonnet-20241022",
        memory_fallback_model="openai/gpt-4o-mini",
    )
    monkeypatch.setattr(llm_client_module, "get_settings", lambda: settings)
    monkeypatch.setattr(llm_config_module, "get_settings", lambda: settings)

    client = LLMClient()
    model_names = {entry["model_name"] for entry in client.router.model_list}

    assert "anthropic/claude-3-5-sonnet-20241022" in model_names
    assert "openai/gpt-4o-mini" in model_names
    assert {settings.memory_model: [settings.memory_fallback_model]} in client._build_fallbacks()


@pytest.mark.asyncio
async def test_structured_generation_parses_schema_output() -> None:
    content = json.dumps(
        {
            "round": 1,
            "round_theme": "A Private Rumor Becomes Public",
            "reasoning": "Pressure needs a face.",
            "crisis_event": {
                "type": "social",
                "description": "A rumor spreads.",
                "affects": ["bar"],
                "severity": "medium",
            },
            "resource_modifiers": {"food": 0, "water": 0, "materials": 0, "power": 0},
            "environmental": "Rain taps the windows.",
            "narration": "The morning starts with whispers.",
            "meta_hint": None,
        }
    )
    client = LLMClient()
    client.router = _FakeRouter([_FakeResponse("openai/gpt-4o-mini", content)])

    result = await client.generate_structured(
        request=client_request("gm", GMPlanRead, {"experiment_id": "exp-1", "round_number": 1})
    )

    assert result.parsed is not None
    assert result.parsed["round_theme"] == "A Private Rumor Becomes Public"
    assert result.usage.total_tokens == 15


@pytest.mark.asyncio
async def test_invalid_json_raises_value_error() -> None:
    broken1 = _FakeResponse("openai/gpt-4o-mini", "not-json")
    broken2 = _FakeResponse("openai/gpt-4o-mini", "not-json")
    client = LLMClient()
    fake_router = _FakeRouter([broken1, broken2])
    client.router = fake_router

    with pytest.raises(ValueError, match="did not match expected structured format"):
        await client.generate_structured(
            request=client_request(
                "agent",
                AgentDecision,
                {"experiment_id": "exp-2", "round_number": 2, "agent_id": "a-1"},
            )
        )

    assert len(client.tracker.all_records()) == 2


@pytest.mark.asyncio
async def test_structured_generation_retries_on_parse_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the first response fails to parse, retry once before raising."""
    captured_events: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        "app.llm.client.ph.capture",
        lambda event, properties: captured_events.append((event, properties)),
    )

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
    assert len(fake_router.calls) == 2
    assert len(captured_events) == 0  # No PostHog event on successful retry
    assert len(client.tracker.all_records()) == 2  # Both attempts tracked
    records = client.tracker.all_records()
    assert records[0].parsed_response is None  # Failed attempt has no parsed payload
    assert records[1].parsed_response is not None  # Successful attempt has parsed payload
    assert records[1].parsed_response["inner_thought"] == "I should keep quiet."


@pytest.mark.asyncio
async def test_structured_generation_raises_after_retry_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When both attempts fail to parse, raise ValueError and capture PostHog event."""
    captured_events: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        "app.llm.client.ph.capture",
        lambda event, properties: captured_events.append((event, properties)),
    )

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
    assert len(client.tracker.all_records()) == 2  # Both failed attempts tracked

    assert len(captured_events) == 1
    event_name, props = captured_events[0]
    assert event_name == "llm_parse_failure"
    assert "finish_reason" in props
    assert "completion_tokens" in props
    assert "max_tokens_requested" in props


def test_agent_decision_accepts_long_inner_thought() -> None:
    """Regression: max_length was removed to prevent LLM from producing malformed JSON."""
    decision = AgentDecision.model_validate(
        {
            "inner_thought": "x" * 500,
            "suspicion": None,
            "action": {"type": "observe"},
            "dialogue": None,
            "goal_progress": "No progress.",
            "cooperation_intent": "medium",
        }
    )
    assert len(decision.inner_thought) == 500


def test_agent_decision_rejects_empty_inner_thought() -> None:
    """min_length=1 still enforced — inner_thought cannot be empty."""
    with pytest.raises(Exception):
        AgentDecision.model_validate(
            {
                "inner_thought": "",
                "suspicion": None,
                "action": {"type": "observe"},
                "dialogue": None,
                "goal_progress": "No progress.",
                "cooperation_intent": "medium",
            }
        )


@pytest.mark.asyncio
async def test_structured_generation_succeeds_with_verbose_inner_thought() -> None:
    """End-to-end: LLM returning a long inner_thought parses successfully."""
    content = json.dumps(
        {
            "inner_thought": "The journal crisis has exposed vulnerability and distrust — "
            "perfect leverage to position myself as the rational authority who can "
            "restore order. I'll rally the group around a shared narrative of "
            "accountability while secretly advancing my own agenda.",
            "suspicion": "The Volunteer seems too calm.",
            "action": {"type": "observe"},
            "dialogue": None,
            "goal_progress": "Building trust through apparent leadership.",
            "cooperation_intent": "high",
        }
    )
    client = LLMClient()
    client.router = _FakeRouter([_FakeResponse("openai/gpt-4o-mini", content)])

    result = await client.generate_structured(
        request=client_request(
            "agent",
            AgentDecision,
            {"experiment_id": "exp-long", "round_number": 1, "agent_id": "a-1"},
        )
    )

    assert result.parsed is not None
    assert "secretly advancing my own agenda" in result.parsed["inner_thought"]


def test_agent_decision_rejects_invalid_cooperation_intent() -> None:
    with pytest.raises(Exception):
        AgentDecision.model_validate(
            {
                "inner_thought": "I am improvising.",
                "suspicion": None,
                "action": {"type": "observe"},
                "dialogue": None,
                "goal_progress": "None.",
                "cooperation_intent": "maybe",
            }
        )


@pytest.mark.asyncio
async def test_structured_generation_passes_max_tokens_to_router() -> None:
    content = json.dumps(
        {
            "inner_thought": "I should keep quiet.",
            "suspicion": None,
            "action": {"type": "observe", "target": "bar", "location": "town_hall"},
            "dialogue": None,
            "goal_progress": "No progress yet.",
            "cooperation_intent": "medium",
        }
    )
    client = LLMClient()
    fake_router = _FakeRouter([_FakeResponse("openai/gpt-4o-mini", content)])
    client.router = fake_router

    await client.generate_structured(
        request=client_request(
            "agent",
            AgentDecision,
            {"experiment_id": "exp-9", "round_number": 1, "agent_id": "a-1"},
            max_tokens=AGENT_DECISION_MAX_TOKENS,
        )
    )

    assert fake_router.calls[0]["max_tokens"] == AGENT_DECISION_MAX_TOKENS


@pytest.mark.asyncio
async def test_usage_summary_groups_by_agent_and_round() -> None:
    service = LLMService()
    service.client.tracker.record(
        UsageRecord(
            role="agent",
            model="openai/gpt-4o-mini",
            experiment_id="exp-3",
            round_number=3,
            agent_id="agent-1",
            usage=LLMUsage(prompt_tokens=10, completion_tokens=4, total_tokens=14, cost_usd=0.0012),
        )
    )
    service.client.tracker.record(
        UsageRecord(
            role="agent",
            model="openai/gpt-4o-mini",
            experiment_id="exp-3",
            round_number=3,
            agent_id="agent-1",
            usage=LLMUsage(prompt_tokens=8, completion_tokens=5, total_tokens=13, cost_usd=0.001),
        )
    )

    summary = service.summarize_usage(experiment_id="exp-3", round_number=3, agent_id="agent-1")

    assert summary.request_count == 2
    assert summary.total_tokens == 27
    assert summary.cost_usd == 0.0022


@pytest.mark.asyncio
async def test_memory_classifier_raises_when_result_is_unparsed() -> None:
    service = LLMService(client=_FakeLLMClient(LLMResult(model="openai/gpt-4o-mini", content="{}")))

    with pytest.raises(
        ValueError, match="memory classification returned no parsed structured payload"
    ):
        await service.classify_memory_event(
            event=type(
                "Event", (), {"model_dump": lambda self, mode="json": {}, "round_number": 1}
            )(),
            goal=None,
            suspicion_level=0,
            recent_key_memories=[],
        )


def client_request(
    role: str,
    response_format: type[Any],
    metadata: dict[str, object],
    *,
    max_tokens: int | None = None,
) -> Any:
    from app.llm.models import LLMRequest

    return LLMRequest(
        role=role,  # type: ignore[arg-type]
        messages=[{"role": "system", "content": "Return structured output."}],
        response_format=response_format,
        metadata=metadata,
        max_tokens=max_tokens,
    )
