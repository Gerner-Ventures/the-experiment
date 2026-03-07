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
from app.schemas.agent_decision import AgentDecision
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
    def __init__(self, content: str) -> None:
        self.message = _FakeMessage(content)


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
    assert set(configs) == {"gm", "agent"}
    assert configs["gm"].primary_model
    assert configs["agent"].fallback_models


def test_router_model_list_includes_memory_model(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(memory_model="anthropic/claude-3-5-sonnet-20241022")
    monkeypatch.setattr(llm_client_module, "get_settings", lambda: settings)
    monkeypatch.setattr(llm_config_module, "get_settings", lambda: settings)

    client = LLMClient()
    model_names = {entry["model_name"] for entry in client.router.model_list}

    assert "anthropic/claude-3-5-sonnet-20241022" in model_names


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
async def test_one_repair_pass_is_used_for_invalid_json() -> None:
    broken = _FakeResponse("openai/gpt-4o-mini", "not-json")
    repaired = _FakeResponse(
        "openai/gpt-4o-mini",
        json.dumps(
            {
                "inner_thought": "I should keep quiet.",
                "suspicion": None,
                "action": {"type": "observe", "target": "bar", "location": "town_hall"},
                "dialogue": None,
                "goal_progress": "No progress yet.",
                "cooperation_intent": "medium",
            }
        ),
    )
    client = LLMClient()
    fake_router = _FakeRouter([broken, repaired])
    client.router = fake_router

    result = await client.generate_structured(
        request=client_request(
            "agent", AgentDecision, {"experiment_id": "exp-2", "round_number": 2, "agent_id": "a-1"}
        )
    )

    assert result.repaired is True
    assert result.parsed is not None
    assert len(fake_router.calls) == 2
    assert fake_router.calls[1]["temperature"] == 0


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

    with pytest.raises(ValueError, match="memory classification returned no parsed structured payload"):
        await service.classify_memory_event(
            event=type("Event", (), {"model_dump": lambda self, mode="json": {}, "round_number": 1})(),
            goal=None,
            suspicion_level=0,
            recent_key_memories=[],
        )


def client_request(role: str, response_format: type[Any], metadata: dict[str, object]) -> Any:
    from app.llm.models import LLMRequest

    return LLMRequest(
        role=role,  # type: ignore[arg-type]
        messages=[{"role": "system", "content": "Return structured output."}],
        response_format=response_format,
        metadata=metadata,
    )
