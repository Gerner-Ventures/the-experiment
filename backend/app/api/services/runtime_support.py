from __future__ import annotations

from collections import defaultdict
from typing import Any, Literal, TypedDict, cast, get_args

from app.api.models import AgentGoalProgress, EventLogItem
from app.db.models import AgentStatus
from app.engine.models import FactionKind

COOPERATIVE_ACTION_TYPES = {
    "gather",
    "repair",
    "talk",
    "trade",
    "rest",
    "observe",
    "pray",
    "rally",
    "mourn",
}
SABOTAGE_ACTION_TYPES = {"sabotage"}
HOSTILE_ACTION_TYPES = {"accuse", "attack", "threaten", "stab", "shoot", "poison"}
GOAL_ACHIEVED_KEYWORDS = ("achieved", "completed", "fulfilled", "succeeded", "escaped", "revealed")
GOAL_FAILED_KEYWORDS = ("no progress", "failed", "stalled", "blocked", "lost", "setback")
GOAL_PARTIAL_KEYWORDS = ("closer", "progress", "holding", "step", "movement", "advance")


class AgentSpeechEntry(TypedDict):
    agent_id: str
    character_id: str
    round_number: int
    index: int
    text: str
    source: str


class CooperationMetrics(TypedDict):
    score: float
    cooperative_actions: int
    total_actions: int


GoalOutcome = Literal["achieved", "partial", "failed", "unknown"]


def round_summary_data(logs: list[EventLogItem]) -> dict[int, dict[str, Any]]:
    summaries: dict[int, dict[str, Any]] = {}
    for item in logs:
        if item.type != "round_end" or item.round_number is None:
            continue
        summaries[item.round_number] = item.data
    return summaries


def cooperation_data(data: dict[str, Any]) -> CooperationMetrics:
    cooperation = data.get("cooperation", {})
    if isinstance(cooperation, dict):
        return {
            "score": float_value(cooperation.get("score")),
            "cooperative_actions": int(cooperation.get("cooperative_actions", 0)),
            "total_actions": int(cooperation.get("total_actions", 0)),
        }
    return {"score": 0.0, "cooperative_actions": 0, "total_actions": 0}


def goal_progress_index(data: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    records: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in data.get("goal_progress", []):
        if not isinstance(item, dict):
            continue
        agent_id = item.get("agent_id")
        if not isinstance(agent_id, str):
            continue
        records[agent_id].append(item)
    return dict(records)


def suspicion_data(data: dict[str, Any]) -> list[dict[str, Any]]:
    suspicion = data.get("suspicion", [])
    return [item for item in suspicion if isinstance(item, dict)]


def faction_data(data: dict[str, Any]) -> list[dict[str, Any]]:
    factions = data.get("factions", [])
    return [item for item in factions if isinstance(item, dict)]


def crisis_event_data(data: dict[str, Any]) -> dict[str, Any]:
    gm = data.get("gm", {})
    if isinstance(gm, dict) and isinstance(gm.get("crisis_event"), dict):
        return cast(dict[str, Any], gm["crisis_event"])
    return {}


def resource_data(data: dict[str, Any]) -> dict[str, float]:
    resources = data.get("resources", {})
    if not isinstance(resources, dict):
        return {}
    return {key: float_value(value) for key, value in resources.items() if isinstance(key, str)}


def dominant_faction_name(data: dict[str, Any]) -> str | None:
    dominant_faction = data.get("dominant_faction")
    return dominant_faction if isinstance(dominant_faction, str) else None


def requested_action_type(item: EventLogItem) -> str | None:
    requested_action = item.data.get("requested_action_type")
    if isinstance(requested_action, str):
        return requested_action
    action = item.data.get("action")
    if isinstance(action, dict):
        raw_type = action.get("type")
        return raw_type if isinstance(raw_type, str) else None
    if isinstance(action, str):
        return action
    return None


def resolved_action_type(item: EventLogItem) -> str | None:
    resolved_action = item.data.get("resolved_action_type")
    if isinstance(resolved_action, str):
        return resolved_action
    action_type = item.data.get("action_type")
    if isinstance(action_type, str):
        return action_type
    action = item.data.get("action")
    if isinstance(action, dict):
        raw_type = action.get("type")
        return raw_type if isinstance(raw_type, str) else None
    if isinstance(action, str):
        return action
    return None


def is_consequence_action(item: EventLogItem) -> bool:
    return bool(item.data.get("is_consequence"))


def is_betrayal_action(
    requested_action: str | None,
    resolved_action: str | None,
) -> bool:
    return (
        requested_action in SABOTAGE_ACTION_TYPES
        or resolved_action in SABOTAGE_ACTION_TYPES
        or requested_action in HOSTILE_ACTION_TYPES
        or resolved_action in HOSTILE_ACTION_TYPES
    )


def phase_sort_key(phase: str | None) -> int:
    order = {"gm_plan": 0, "dawn": 1, "morning": 2, "midday": 3, "afternoon": 4, "night": 5}
    return order.get(phase or "", 99)


def status_value(status: AgentStatus | str) -> str:
    return status.value if isinstance(status, AgentStatus) else str(status)


def goal_outcome(
    status: str,
    history: list[AgentGoalProgress],
) -> GoalOutcome:
    progress_samples = [entry.progress.lower() for entry in history]
    if any(
        keyword in progress_text
        for progress_text in progress_samples
        for keyword in GOAL_ACHIEVED_KEYWORDS
    ):
        return "achieved"
    if status == "exiled" or any(
        keyword in progress_text
        for progress_text in progress_samples
        for keyword in GOAL_FAILED_KEYWORDS
    ):
        return "failed"
    if any(
        keyword in progress_text
        for progress_text in progress_samples
        for keyword in GOAL_PARTIAL_KEYWORDS
    ):
        return "partial"
    return "unknown"


def string_value(value: object, *, default: str | None = None) -> str | None:
    if isinstance(value, str):
        return value
    return default


def faction_kind(value: object) -> FactionKind | None:
    if value in get_args(FactionKind):
        return cast(FactionKind, value)
    return None


def string_or(value: object, default: str = "") -> str:
    if isinstance(value, str):
        return value
    return default


def float_value(value: object) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return 0.0
    return 0.0
