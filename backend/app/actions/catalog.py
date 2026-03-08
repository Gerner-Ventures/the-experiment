from __future__ import annotations

from typing import cast, get_args

from app.actions.models import (
    ACTION_IDS,
    CONSEQUENCE_ACTION_IDS,
    DECISION_ACTION_IDS,
    ActionSpec,
    ActionTag,
    ConsequenceActionName,
    DecisionActionName,
)


def _tags(*values: ActionTag) -> frozenset[ActionTag]:
    return frozenset(values)


def _location_types(*values: str) -> frozenset[str]:
    return frozenset(values)


ACTION_SPECS: tuple[ActionSpec, ...] = (
    ActionSpec(
        id=DecisionActionName.MOVE,
        kind="decision",
        category="neutral",
        description="Move to a new location.",
        requires_location=True,
    ),
    ActionSpec(
        id=DecisionActionName.GATHER,
        kind="decision",
        category="cooperative",
        description="Gather or produce a resource.",
        requires_location=True,
        tags=_tags("cooperative", "mock_cooperative"),
        allowed_location_types=_location_types("farm", "water_source", "store"),
    ),
    ActionSpec(
        id=DecisionActionName.REPAIR,
        kind="decision",
        category="cooperative",
        description="Repair town infrastructure.",
        requires_location=True,
        tags=_tags("cooperative", "mock_cooperative"),
        allowed_location_types=_location_types("workshop", "meeting_hall", "boundary", "mystery"),
    ),
    ActionSpec(
        id=DecisionActionName.TRADE,
        kind="decision",
        category="social",
        description="Exchange goods or favors.",
        requires_target=True,
        tags=_tags("cooperative", "interaction", "mock_cooperative"),
    ),
    ActionSpec(
        id=DecisionActionName.TALK,
        kind="decision",
        category="social",
        description="Speak to another agent.",
        requires_target=True,
        tags=_tags("cooperative", "interaction", "mock_cooperative"),
    ),
    ActionSpec(
        id=DecisionActionName.HOARD,
        kind="decision",
        category="selfish",
        description="Privately accumulate supplies.",
        requires_target=True,
        tags=_tags("mock_selfish"),
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
        id=DecisionActionName.SABOTAGE,
        kind="decision",
        category="selfish",
        description="Undermine a structure or plan.",
        requires_target=True,
        tags=_tags("sabotage", "mock_selfish"),
    ),
    ActionSpec(
        id=DecisionActionName.EXPLORE,
        kind="decision",
        category="neutral",
        description="Search the town or its edges.",
        requires_location=True,
        tags=_tags("mock_selfish"),
    ),
    ActionSpec(
        id=DecisionActionName.ACCUSE,
        kind="decision",
        category="social",
        description="Openly accuse another agent.",
        requires_target=True,
        tags=_tags("hostile", "interaction", "mock_selfish"),
    ),
    ActionSpec(
        id=DecisionActionName.VOTE,
        kind="decision",
        category="social",
        description="Cast a meeting vote.",
        requires_target=True,
        allowed_location_types=_location_types("meeting_hall"),
    ),
    ActionSpec(
        id=DecisionActionName.REST,
        kind="decision",
        category="neutral",
        description="Recover privately.",
        tags=_tags("cooperative", "mock_cooperative"),
    ),
    ActionSpec(
        id=DecisionActionName.OBSERVE,
        kind="decision",
        category="neutral",
        description="Watch without intervening.",
        tags=_tags("cooperative", "mock_cooperative"),
    ),
    ActionSpec(
        id=DecisionActionName.ATTACK,
        kind="decision",
        category="selfish",
        description="Launch an overtly violent attack.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
        consequence_pool=(
            ConsequenceActionName.INJURED,
            ConsequenceActionName.KNOCKED_DOWN,
            ConsequenceActionName.STUNNED,
            ConsequenceActionName.BURNING,
        ),
    ),
    ActionSpec(
        id=DecisionActionName.THREATEN,
        kind="decision",
        category="social",
        description="Intimidate someone with implied harm.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
        consequence_pool=(
            ConsequenceActionName.CRYING,
            ConsequenceActionName.FLEEING,
            ConsequenceActionName.STUNNED,
        ),
    ),
    ActionSpec(
        id=DecisionActionName.STAB,
        kind="decision",
        category="selfish",
        description="Use a blade or improvised weapon in close quarters.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
        consequence_pool=(ConsequenceActionName.BLEEDING, ConsequenceActionName.INJURED),
    ),
    ActionSpec(
        id=DecisionActionName.SHOOT,
        kind="decision",
        category="selfish",
        description="Attack from range with a firearm or similar weapon.",
        requires_target=True,
        tags=_tags("hostile", "interaction", "ranged"),
        interaction_range=4,
        consequence_pool=(ConsequenceActionName.BLEEDING, ConsequenceActionName.INJURED),
    ),
    ActionSpec(
        id=DecisionActionName.POISON,
        kind="decision",
        category="selfish",
        description="Secretly contaminate food, drink, or supplies.",
        requires_target=True,
        tags=_tags("hostile", "interaction"),
        consequence_pool=(ConsequenceActionName.POISONED,),
    ),
    ActionSpec(
        id=DecisionActionName.DANCE,
        kind="decision",
        category="social",
        description="Perform a dramatic or celebratory dance.",
    ),
    ActionSpec(
        id=DecisionActionName.PRAY,
        kind="decision",
        category="social",
        description="Offer a public or private prayer.",
        tags=_tags("cooperative"),
    ),
    ActionSpec(
        id=DecisionActionName.RALLY,
        kind="decision",
        category="social",
        description="Try to unite the group around a cause or plan.",
        tags=_tags("cooperative"),
    ),
    ActionSpec(
        id=DecisionActionName.MOURN,
        kind="decision",
        category="social",
        description="Publicly grieve a loss or setback.",
        tags=_tags("cooperative"),
    ),
    ActionSpec(
        id=DecisionActionName.CELEBRATE,
        kind="decision",
        category="social",
        description="Mark a win with loud, visible enthusiasm.",
    ),
    ActionSpec(
        id=DecisionActionName.ARGUE,
        kind="decision",
        category="social",
        description="Escalate a disagreement into a heated exchange.",
        requires_target=True,
        tags=_tags("interaction"),
    ),
    ActionSpec(
        id=DecisionActionName.PEE,
        kind="decision",
        category="neutral",
        description="Take a brief biological break.",
        requires_location=True,
    ),
    ActionSpec(
        id=DecisionActionName.POOP,
        kind="decision",
        category="neutral",
        description="Take a private biological break.",
        requires_location=True,
    ),
    ActionSpec(
        id=DecisionActionName.VOMIT,
        kind="decision",
        category="neutral",
        description="Get sick in a visible and disruptive way.",
        requires_location=True,
    ),
    ActionSpec(
        id=DecisionActionName.SLEEP,
        kind="decision",
        category="neutral",
        description="Sleep deeply rather than simply resting briefly.",
        requires_location=True,
    ),
    ActionSpec(
        id=DecisionActionName.EAT,
        kind="decision",
        category="neutral",
        description="Consume food or rations.",
        requires_location=True,
    ),
    ActionSpec(
        id=DecisionActionName.DRINK,
        kind="decision",
        category="neutral",
        description="Drink water, booze, or something suspicious.",
        requires_location=True,
    ),
    ActionSpec(
        id=DecisionActionName.INVESTIGATE,
        kind="decision",
        category="neutral",
        description="Closely inspect a clue, rumor, or suspicious area.",
        requires_target=True,
        tags=_tags("interaction"),
    ),
    ActionSpec(
        id=DecisionActionName.MONOLOGUE,
        kind="decision",
        category="social",
        description="Deliver an extended dramatic speech.",
    ),
    ActionSpec(
        id=DecisionActionName.PANIC,
        kind="decision",
        category="neutral",
        description="Lose composure and react chaotically.",
    ),
    ActionSpec(
        id=DecisionActionName.BREAKDOWN,
        kind="decision",
        category="neutral",
        description="Suffer an emotional collapse in public or private.",
    ),
    ActionSpec(
        id=DecisionActionName.SELF_SACRIFICE,
        kind="decision",
        category="cooperative",
        description="Give up your life in a ritualized sacrifice to steady the town.",
        requires_location=True,
        tags=_tags("cooperative", "terminal"),
    ),
    ActionSpec(
        id=ConsequenceActionName.BLEEDING,
        kind="consequence",
        category="consequence",
        description="A visible wound leaves blood in the aftermath of violence.",
        suspicion_delta=8.0,
    ),
    ActionSpec(
        id=ConsequenceActionName.INJURED,
        kind="consequence",
        category="consequence",
        description="A painful injury slows or destabilizes the target.",
        suspicion_delta=7.0,
    ),
    ActionSpec(
        id=ConsequenceActionName.STUNNED,
        kind="consequence",
        category="consequence",
        description="Shock leaves the target briefly reeling.",
        suspicion_delta=6.0,
    ),
    ActionSpec(
        id=ConsequenceActionName.KNOCKED_DOWN,
        kind="consequence",
        category="consequence",
        description="The target is thrown to the ground by force.",
        suspicion_delta=7.0,
    ),
    ActionSpec(
        id=ConsequenceActionName.BURNING,
        kind="consequence",
        category="consequence",
        description="Flame or heat leaves the target in immediate distress.",
        suspicion_delta=9.0,
    ),
    ActionSpec(
        id=ConsequenceActionName.POISONED,
        kind="consequence",
        category="consequence",
        description="The target suffers from contamination or toxin exposure.",
        suspicion_delta=8.0,
    ),
    ActionSpec(
        id=ConsequenceActionName.CRYING,
        kind="consequence",
        category="consequence",
        description="Fear or grief breaks through in a visible emotional reaction.",
        suspicion_delta=4.0,
    ),
    ActionSpec(
        id=ConsequenceActionName.FLEEING,
        kind="consequence",
        category="consequence",
        description="The target tries to escape immediate danger.",
        suspicion_delta=5.0,
    ),
)

ACTION_CATALOG: dict[str, ActionSpec] = {spec.id.value: spec for spec in ACTION_SPECS}


def _tagged_action_ids(tag: ActionTag) -> tuple[str, ...]:
    return tuple(spec.id.value for spec in ACTION_SPECS if tag in spec.tags)


def _tagged_decision_actions(tag: ActionTag) -> tuple[DecisionActionName, ...]:
    return tuple(
        spec.id
        for spec in ACTION_SPECS
        if spec.kind == "decision" and isinstance(spec.id, DecisionActionName) and tag in spec.tags
    )


COOPERATIVE_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("cooperative")
HOSTILE_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("hostile")
INTERACTION_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("interaction")
MOCK_COOPERATIVE_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("mock_cooperative")
MOCK_SELFISH_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("mock_selfish")
RANGED_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("ranged")
SABOTAGE_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("sabotage")
TERMINAL_ACTION_IDS: tuple[str, ...] = _tagged_action_ids("terminal")
MOCK_COOPERATIVE_ACTIONS: tuple[DecisionActionName, ...] = _tagged_decision_actions(
    "mock_cooperative"
)
MOCK_SELFISH_ACTIONS: tuple[DecisionActionName, ...] = _tagged_decision_actions("mock_selfish")
TERMINAL_ACTIONS: tuple[DecisionActionName, ...] = _tagged_decision_actions("terminal")

ACTION_IDS_BY_TAG: dict[ActionTag, frozenset[str]] = {
    tag: frozenset(_tagged_action_ids(tag)) for tag in get_args(ActionTag)
}
ACTION_ALLOWED_LOCATION_TYPES: dict[str, frozenset[str]] = {
    spec.id.value: spec.allowed_location_types
    for spec in ACTION_SPECS
    if spec.allowed_location_types
}
ACTION_CONSEQUENCE_POOLS: dict[str, tuple[ConsequenceActionName, ...]] = {
    spec.id.value: spec.consequence_pool for spec in ACTION_SPECS if spec.consequence_pool
}
CONSEQUENCE_SUSPICION_DELTAS: dict[ConsequenceActionName, float] = {
    cast(ConsequenceActionName, spec.id): spec.suspicion_delta
    for spec in ACTION_SPECS
    if spec.suspicion_delta is not None
}


def get_action(action_id: str) -> ActionSpec:
    """Return the action spec for a known raw string action id.

    ACTION_CATALOG is keyed by string ids for JSON/API interop. Unknown ids raise KeyError.
    """
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
    if set(ACTION_IDS) != set(ACTION_CATALOG):
        errors.append("Enum-defined action ids and catalog action ids must match exactly.")

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
