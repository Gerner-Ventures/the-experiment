from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum, unique
from typing import Literal


@unique
class DecisionActionName(StrEnum):
    MOVE = "move"
    GATHER = "gather"
    REPAIR = "repair"
    TRADE = "trade"
    TALK = "talk"
    HOARD = "hoard"
    SABOTAGE = "sabotage"
    EXPLORE = "explore"
    ACCUSE = "accuse"
    VOTE = "vote"
    REST = "rest"
    OBSERVE = "observe"
    ATTACK = "attack"
    THREATEN = "threaten"
    STAB = "stab"
    SHOOT = "shoot"
    POISON = "poison"
    DANCE = "dance"
    PRAY = "pray"
    RALLY = "rally"
    MOURN = "mourn"
    CELEBRATE = "celebrate"
    ARGUE = "argue"
    PEE = "pee"
    POOP = "poop"
    VOMIT = "vomit"
    SLEEP = "sleep"
    EAT = "eat"
    DRINK = "drink"
    INVESTIGATE = "investigate"
    MONOLOGUE = "monologue"
    PANIC = "panic"
    BREAKDOWN = "breakdown"
    SELF_SACRIFICE = "self_sacrifice"


@unique
class ConsequenceActionName(StrEnum):
    BLEEDING = "bleeding"
    INJURED = "injured"
    STUNNED = "stunned"
    KNOCKED_DOWN = "knocked_down"
    BURNING = "burning"
    POISONED = "poisoned"
    CRYING = "crying"
    FLEEING = "fleeing"


ActionName = DecisionActionName | ConsequenceActionName
ActionKind = Literal["decision", "consequence"]
ActionCategory = Literal["cooperative", "selfish", "neutral", "social", "consequence"]
ActionTag = Literal[
    "cooperative",
    "hostile",
    "interaction",
    "mock_cooperative",
    "mock_selfish",
    "ranged",
    "sabotage",
    "terminal",
]

DECISION_ACTION_IDS: tuple[str, ...] = tuple(action.value for action in DecisionActionName)
CONSEQUENCE_ACTION_IDS: tuple[str, ...] = tuple(action.value for action in ConsequenceActionName)
ACTION_IDS: tuple[str, ...] = (*DECISION_ACTION_IDS, *CONSEQUENCE_ACTION_IDS)


@dataclass(frozen=True, slots=True)
class ActionSpec:
    id: ActionName
    kind: ActionKind
    category: ActionCategory
    description: str
    requires_target: bool = False
    requires_location: bool = False
    tags: frozenset[ActionTag] = field(default_factory=frozenset)
    allowed_location_types: frozenset[str] = field(default_factory=frozenset)
    interaction_range: int | None = None
    consequence_pool: tuple[ConsequenceActionName, ...] = ()
    suspicion_delta: float | None = None
