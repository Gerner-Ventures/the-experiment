from typing import Any

import pytest

from app.gm import (
    GMPlanningContext,
    GMService,
    build_prompt_package,
    generate_rule_based_plan,
    get_current_act,
    get_preset_arc,
    is_act_transition,
    list_preset_arcs,
    validate_arc,
)
from app.llm import LLMService
from app.llm.models import LLMResult
from app.world import build_default_world_state


def _context(round_number: int, auto_approve: bool = False) -> GMPlanningContext:
    return GMPlanningContext(
        round_number=round_number,
        total_rounds=15,
        arc=get_preset_arc("slow_burn"),
        world_state=build_default_world_state(round_number=round_number),
        threat_level=18.0 if round_number < 8 else 52.0,
        cooperation_ratio=0.78 if round_number < 8 else 0.41,
        unresolved_plotlines=["Someone keeps hearing the locked building hum like a heartbeat."],
        relationships_summary="Two quiet alliances have formed, but both are hiding resentment.",
        recent_events=["A missing ration was quietly blamed on the wrong agent."],
        auto_approve=auto_approve,
    )


def test_preset_arcs_are_available_and_valid() -> None:
    presets = list_preset_arcs()
    assert len(presets) == 4
    for arc in presets:
        validate_arc(arc)


def test_director_tracks_current_act_and_transitions() -> None:
    arc = get_preset_arc("slow_burn")
    assert get_current_act(arc, 1).name == "Arrival"
    assert get_current_act(arc, 8).name == "Hairline Cracks"
    assert is_act_transition(arc, 7) is True
    assert is_act_transition(arc, 8) is False


def test_prompt_package_reflects_assertive_gm_brief() -> None:
    prompt = build_prompt_package(_context(4))
    assert "do not wait passively for drama" in prompt.system_prompt.lower()
    assert "slow burn" in prompt.user_prompt.lower()
    assert "relationships summary" in prompt.user_prompt.lower()


def test_rule_based_plan_pushes_drama_even_when_calm() -> None:
    plan = generate_rule_based_plan(_context(3))
    assert plan.round_theme
    assert plan.crisis_event.type in {
        "social",
        "meta",
        "discovery",
        "environmental",
        "resource",
        "structural",
    }
    assert "assertive pacing" in plan.reasoning.lower()


class _StubLLMService(LLMService):
    async def generate_gm_plan(
        self,
        *,
        messages: list[dict[str, str]],
        response_format: dict[str, object] | type[Any],
        metadata: dict[str, object] | None = None,
        model_override: str | None = None,
        generation_name: str | None = None,
    ) -> LLMResult:
        return LLMResult(
            model="anthropic/claude-3-5-sonnet-20241022",
            content="",
            parsed={
                "round": 10,
                "round_theme": "A Witness Breaks Pattern",
                "reasoning": "Escalate the social fracture.",
                "crisis_event": {
                    "type": "social",
                    "description": "A witness publicly contradicts yesterday's story.",
                    "affects": ["town_square", "bar"],
                    "severity": "high",
                },
                "resource_modifiers": {"food": -2, "water": 0, "materials": 0, "power": -1},
                "environmental": "The air feels electrically charged.",
                "narration": "The square goes quiet before everyone starts talking at once.",
                "meta_hint": "Someone is paying too much attention to the contradictions.",
            },
        )


@pytest.mark.asyncio
async def test_auto_approve_flow_applies_immediately() -> None:
    service = GMService(llm_service=_StubLLMService())
    record = await service.generate_plan(_context(10, auto_approve=True))
    assert record.status == "applied"
    assert record.approved_at is not None
    assert record.applied_at is not None


@pytest.mark.asyncio
async def test_gm_service_uses_llm_plan_when_available() -> None:
    service = GMService(llm_service=_StubLLMService())

    record = await service.generate_plan(_context(10))

    assert record.plan.round_theme == "A Witness Breaks Pattern"
    assert record.plan.crisis_event.description.startswith("A witness publicly")
