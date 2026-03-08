from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

ActionKind = Literal["decision", "consequence"]
ActionCategory = Literal["cooperative", "selfish", "neutral", "social", "consequence"]
ActionTag = Literal[
    "cooperative",
    "hostile",
    "interaction",
    "mock_cooperative",
    "ranged",
    "sabotage",
    "terminal",
]


@dataclass(frozen=True, slots=True)
class ActionSpec:
    id: str
    kind: ActionKind
    category: ActionCategory
    description: str
    requires_target: bool = False
    requires_location: bool = False
    tags: frozenset[ActionTag] = field(default_factory=frozenset)
    allowed_location_types: frozenset[str] = field(default_factory=frozenset)
    interaction_range: int | None = None
    consequence_pool: tuple[str, ...] = ()
    suspicion_delta: float | None = None
