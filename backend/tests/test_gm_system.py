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
from app.gm.models import GM_NARRATION_MAX_WORDS, GMPlanData
from app.llm import LLMService
from app.llm.models import LLMResult
from app.world import build_default_world_state


def _plan_with_narration(narration: str) -> GMPlanData:
    return GMPlanData.model_validate(
        {
            "round": 1,
            "round_theme": "The Town Hears Itself Breathe",
            "reasoning": "Keep the opener tight.",
            "crisis_event": {
                "type": "social",
                "description": "A hush falls over the square.",
                "affects": ["town_square"],
                "severity": "low",
            },
            "resource_modifiers": {"food": 0, "water": 0, "materials": 0, "power": 0},
            "narration": narration,
        }
    )


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
    assert "15-20 seconds" in prompt.user_prompt
    assert f"{GM_NARRATION_MAX_WORDS} words" in prompt.user_prompt


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


def test_gm_plan_data_caps_narration_to_short_spoken_length() -> None:
    long_narration = " ".join(f"word{i}" for i in range(GM_NARRATION_MAX_WORDS + 8))

    plan = _plan_with_narration(long_narration)

    assert len(plan.narration.split()) == GM_NARRATION_MAX_WORDS
    assert plan.narration.endswith("...")


def test_gm_plan_data_strips_trailing_comma_before_appending_ellipsis() -> None:
    words = [f"word{i}" for i in range(GM_NARRATION_MAX_WORDS - 1)]
    words.append(f"word{GM_NARRATION_MAX_WORDS - 1},")
    words.extend(["after", "that"])

    plan = _plan_with_narration(" ".join(words))

    assert len(plan.narration.split()) == GM_NARRATION_MAX_WORDS
    assert not plan.narration.endswith(",...")
    assert plan.narration.endswith("...")


def test_gm_plan_data_preserves_terminal_period_without_ellipsis() -> None:
    words = [f"word{i}" for i in range(GM_NARRATION_MAX_WORDS - 1)]
    words.append(f"word{GM_NARRATION_MAX_WORDS - 1}.")
    words.extend(["after", "that"])

    plan = _plan_with_narration(" ".join(words))

    assert len(plan.narration.split()) == GM_NARRATION_MAX_WORDS
    assert plan.narration.endswith(".")
    assert not plan.narration.endswith("...")


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
        if generation_name == "gm-plan-revise":
            return LLMResult(
                model="anthropic/claude-3-5-sonnet-20241022",
                content="",
                parsed={
                    "round": 999,
                    "round_theme": "A Darker Witness Emerges",
                    "reasoning": "Adjust the full beat toward dread.",
                    "crisis_event": {
                        "type": "structural",
                        "description": "A tremor splits the square and rattles every promise.",
                        "affects": ["town_square", "clinic"],
                        "severity": "high",
                    },
                    "resource_modifiers": {"food": -1, "water": -2, "materials": -1, "power": -3},
                    "environmental": "Dust hangs in the air after the shock.",
                    "narration": "The earth shudders. Everyone hears the town answer back.",
                    "meta_hint": "The revised plan leans into the observer's pressure.",
                },
            )
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


@pytest.mark.asyncio
async def test_gm_service_revise_plan_preserves_round_and_returns_pending() -> None:
    service = GMService(llm_service=_StubLLMService())
    current_plan = _plan_with_narration("The square is too quiet for comfort.")

    record = await service.revise_plan(
        _context(4),
        current_plan,
        "make it darker and add an earthquake",
    )

    assert record.status == "pending"
    assert record.plan.round == current_plan.round
    assert record.plan.round_theme == "A Darker Witness Emerges"
    assert "earth shudders" in record.plan.narration.lower()
