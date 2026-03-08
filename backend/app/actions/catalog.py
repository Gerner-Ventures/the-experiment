from __future__ import annotations

from typing import get_args

from app.actions.models import ActionSpec, ActionTag


def _tags(*values: ActionTag) -> frozenset[ActionTag]:
    return frozenset(values)


def _location_types(*values: str) -> frozenset[str]:
    return frozenset(values)


ACTION_SPECS: tuple[ActionSpec, ...] = (
    ActionSpec(
        id="move",
        kind="decision",
        category="neutral",
        description="Move to a new location.",
        requires_location=True,
    ),
    ActionSpec(
        id="gather",
        kind="decision",
        category="cooperative",
        description="Gather or produce a resource.",
        requires_location=True,
        tags=_tags("cooperative", "mock_cooperative"),
        allowed_location_types=_location_types("farm", "water_source", "store"),
    ),
    ActionSpec(
        id="repair",
        kind="decision",
        category="cooperative",
        description="Repair town infrastructure.",
        requires_location=True,
        tags=_tags("cooperative", "mock_cooperative"),
        allowed_location_types=_location_types("workshop", "meeting_hall", "boundary", "mystery"),
    ),
    ActionSpec(
        id="trade",
        kind="decision",
        category="social",
        description="Exchange goods or favors.",
        requires_target=True,
        tags=_tags("cooperative", "interaction", "mock_cooperative"),
    ),
    ActionSpec(
        id="talk",
        kind="decision",
        category="social",
        description="Speak to another agent.",
        requires_target=True,
        tags=_tags("cooperative", "interaction", "mock_cooperative"),
    ),
    ActionSpec(
        id="hoard",
        kind="decision",
        category="selfish",
        description="Privately accumulate supplies.",
        requires_target=True,
        allowed_location_types=_location_types(
            "farm",
            "water_source",
            "store",
            "residence",
            "bar",
            "brothel",
        ),
    ),
    ActionSpec(
        id="sabotage",
        kind="decision",
        category="selfish",
        description="Undermine a structure or plan.",
        requires_target=True,
        tags=_tags("sabotage"),
    ),
    ActionSpec(
        id="explore",
        kind="decision",
        category="neutral",
        description="Search the town or its edges.",
        requires_location=True,
    ),
    ActionSpec(
        id="accuse",
        kind="decision",
        category="social",
        description="Openly accuse another agent.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
    ),
    ActionSpec(
        id="vote",
        kind="decision",
        category="social",
        description="Cast a meeting vote.",
        requires_target=True,
        allowed_location_types=_location_types("meeting_hall"),
    ),
    ActionSpec(
        id="rest",
        kind="decision",
        category="neutral",
        description="Recover privately.",
        tags=_tags("cooperative", "mock_cooperative"),
    ),
    ActionSpec(
        id="observe",
        kind="decision",
        category="neutral",
        description="Watch without intervening.",
        tags=_tags("cooperative", "mock_cooperative"),
    ),
    ActionSpec(
        id="attack",
        kind="decision",
        category="selfish",
        description="Launch an overtly violent attack.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
        consequence_pool=("injured", "knocked_down", "stunned", "burning"),
    ),
    ActionSpec(
        id="threaten",
        kind="decision",
        category="social",
        description="Intimidate someone with implied harm.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
        consequence_pool=("crying", "fleeing", "stunned"),
    ),
    ActionSpec(
        id="stab",
        kind="decision",
        category="selfish",
        description="Use a blade or improvised weapon in close quarters.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
        consequence_pool=("bleeding", "injured"),
    ),
    ActionSpec(
        id="shoot",
        kind="decision",
        category="selfish",
        description="Attack from range with a firearm or similar weapon.",
        requires_target=True,
        tags=_tags("hostile", "interaction", "ranged"),
        interaction_range=4,
        consequence_pool=("bleeding", "injured"),
    ),
    ActionSpec(
        id="poison",
        kind="decision",
        category="selfish",
        description="Secretly contaminate food, drink, or supplies.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
        consequence_pool=("poisoned",),
    ),
    ActionSpec(
        id="dance",
        kind="decision",
        category="social",
        description="Perform a dramatic or celebratory dance.",
    ),
    ActionSpec(
        id="pray",
        kind="decision",
        category="social",
        description="Offer a public or private prayer.",
        tags=_tags("cooperative"),
    ),
    ActionSpec(
        id="rally",
        kind="decision",
        category="social",
        description="Try to unite the group around a cause or plan.",
        tags=_tags("cooperative"),
    ),
    ActionSpec(
        id="mourn",
        kind="decision",
        category="social",
        description="Publicly grieve a loss or setback.",
        tags=_tags("cooperative"),
    ),
    ActionSpec(
        id="celebrate",
        kind="decision",
        category="social",
        description="Mark a win with loud, visible enthusiasm.",
    ),
    ActionSpec(
        id="argue",
        kind="decision",
        category="social",
        description="Escalate a disagreement into a heated exchange.",
        requires_target=True,
        tags=_tags("interaction"),
    ),
    ActionSpec(
        id="pee",
        kind="decision",
        category="neutral",
        description="Take a brief biological break.",
        requires_location=True,
    ),
    ActionSpec(
        id="poop",
        kind="decision",
        category="neutral",
        description="Take a private biological break.",
        requires_location=True,
    ),
    ActionSpec(
        id="vomit",
        kind="decision",
        category="neutral",
        description="Get sick in a visible and disruptive way.",
        requires_location=True,
    ),
    ActionSpec(
        id="sleep",
        kind="decision",
        category="neutral",
        description="Sleep deeply rather than simply resting briefly.",
        requires_location=True,
    ),
    ActionSpec(
        id="eat",
        kind="decision",
        category="neutral",
        description="Consume food or rations.",
        requires_location=True,
    ),
    ActionSpec(
        id="drink",
        kind="decision",
        category="neutral",
        description="Drink water, booze, or something suspicious.",
        requires_location=True,
    ),
    ActionSpec(
        id="investigate",
        kind="decision",
        category="neutral",
        description="Closely inspect a clue, rumor, or suspicious area.",
        requires_target=True,
        tags=_tags("interaction"),
    ),
    ActionSpec(
        id="monologue",
        kind="decision",
        category="social",
        description="Deliver an extended dramatic speech.",
    ),
    ActionSpec(
        id="panic",
        kind="decision",
        category="neutral",
        description="Lose composure and react chaotically.",
    ),
    ActionSpec(
        id="breakdown",
        kind="decision",
        category="neutral",
        description="Suffer an emotional collapse in public or private.",
    ),
    ActionSpec(
        id="self_sacrifice",
        kind="decision",
        category="cooperative",
        description="Give up your life in a ritualized sacrifice to steady the town.",
        requires_location=True,
        tags=_tags("terminal"),
    ),
    ActionSpec(
        id="bleeding",
        kind="consequence",
        category="consequence",
        description="A visible wound leaves blood in the aftermath of violence.",
        suspicion_delta=8.0,
    ),
    ActionSpec(
        id="injured",
        kind="consequence",
        category="consequence",
        description="A painful injury slows or destabilizes the target.",
        suspicion_delta=7.0,
    ),
    ActionSpec(
        id="stunned",
        kind="consequence",
        category="consequence",
        description="Shock leaves the target briefly reeling.",
        suspicion_delta=6.0,
    ),
    ActionSpec(
        id="knocked_down",
        kind="consequence",
        category="consequence",
        description="The target is thrown to the ground by force.",
        suspicion_delta=7.0,
    ),
    ActionSpec(
        id="burning",
        kind="consequence",
        category="consequence",
        description="Flame or heat leaves the target in immediate distress.",
        suspicion_delta=9.0,
    ),
    ActionSpec(
        id="poisoned",
        kind="consequence",
        category="consequence",
        description="The target suffers from contamination or toxin exposure.",
        suspicion_delta=8.0,
    ),
    ActionSpec(
        id="crying",
        kind="consequence",
        category="consequence",
        description="Fear or grief breaks through in a visible emotional reaction.",
        suspicion_delta=4.0,
    ),
    ActionSpec(
        id="fleeing",
        kind="consequence",
        category="consequence",
        description="The target tries to escape immediate danger.",
        suspicion_delta=5.0,
    ),
)

ACTION_CATALOG: dict[str, ActionSpec] = {spec.id: spec for spec in ACTION_SPECS}
ACTION_IDS: tuple[str, ...] = tuple(spec.id for spec in ACTION_SPECS)
DECISION_ACTION_IDS: tuple[str, ...] = tuple(
    spec.id for spec in ACTION_SPECS if spec.kind == "decision"
)
CONSEQUENCE_ACTION_IDS: tuple[str, ...] = tuple(
    spec.id for spec in ACTION_SPECS if spec.kind == "consequence"
)


def _tagged_action_ids(tag: ActionTag) -> tuple[str, ...]:
    return tuple(spec.id for spec in ACTION_SPECS if tag in spec.tags)


COOPERATIVE_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("cooperative")
HOSTILE_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("hostile")
INTERACTION_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("interaction")
MOCK_COOPERATIVE_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("mock_cooperative")
RANGED_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("ranged")
SABOTAGE_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("sabotage")
TERMINAL_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("terminal")

ACTION_IDS_BY_TAG: dict[ActionTag, frozenset[str]] = {
    tag: frozenset(_tagged_action_ids(tag)) for tag in get_args(ActionTag)
}
ACTION_ALLOWED_LOCATION_TYPES: dict[str, frozenset[str]] = {
    spec.id: spec.allowed_location_types for spec in ACTION_SPECS if spec.allowed_location_types
}
ACTION_CONSEQUENCE_POOLS: dict[str, tuple[str, ...]] = {
    spec.id: spec.consequence_pool for spec in ACTION_SPECS if spec.consequence_pool
}
CONSEQUENCE_SUSPICION_DELTAS: dict[str, float] = {
    spec.id: spec.suspicion_delta for spec in ACTION_SPECS if spec.suspicion_delta is not None
}


def get_action(action_id: str) -> ActionSpec:
    return ACTION_CATALOG[action_id]


def decision_action_ids() -> tuple[str, ...]:
    return DECISION_ACTION_IDS


def consequence_action_ids() -> tuple[str, ...]:
    return CONSEQUENCE_ACTION_IDS


def actions_with_tag(tag: ActionTag) -> frozenset[str]:
    return ACTION_IDS_BY_TAG.get(tag, frozenset())


def action_has_tag(action_id: str, tag: ActionTag) -> bool:
    spec = ACTION_CATALOG.get(action_id)
    return spec is not None and tag in spec.tags


def _validate_catalog() -> None:
    errors: list[str] = []
    if len(ACTION_CATALOG) != len(ACTION_SPECS):
        errors.append("Action ids must be unique.")

    for spec in ACTION_SPECS:
        if spec.interaction_range is not None and "interaction" not in spec.tags:
            errors.append(f"{spec.id} declares interaction_range without interaction tag.")
        if "ranged" in spec.tags and "interaction" not in spec.tags:
            errors.append(f"{spec.id} is ranged but not interaction-based.")
        if spec.kind != "consequence" and spec.suspicion_delta is not None:
            errors.append(f"{spec.id} is not a consequence but declares suspicion_delta.")
        if spec.kind == "consequence" and spec.consequence_pool:
            errors.append(f"{spec.id} is a consequence and cannot declare a consequence pool.")
        for consequence_id in spec.consequence_pool:
            consequence = ACTION_CATALOG.get(consequence_id)
            if consequence is None:
                errors.append(f"{spec.id} references unknown consequence {consequence_id}.")
            elif consequence.kind != "consequence":
                errors.append(
                    f"{spec.id} references {consequence_id}, which is not a consequence action."
                )

    if errors:
        raise ValueError("Invalid action catalog: " + "; ".join(errors))


_validate_catalog()
