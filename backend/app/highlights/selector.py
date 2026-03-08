from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.api.models import EventLogItem, HighlightCategory, HighlightItem, HighlightScope

ROUND_HIGHLIGHT_LIMIT = 5
GAME_HIGHLIGHT_LIMIT = 12
SABOTAGE_ACTION_TYPES = frozenset({"sabotage"})
HOSTILE_ACTION_TYPES = frozenset({"accuse", "attack", "threaten", "stab", "shoot", "poison"})
CRISIS_SEVERITY_SCORES = {"critical": 9.5, "high": 8.5, "medium": 7.5, "low": 6.5}
PHASE_ORDER = {"gm_plan": 0, "dawn": 1, "morning": 2, "midday": 3, "afternoon": 4, "night": 5}


@dataclass(slots=True)
class HighlightCandidate:
    item: HighlightItem
    variety_key: HighlightCategory
    sort_key: tuple[float, int, int, int]


class HighlightSelector:
    def select(
        self,
        logs: list[EventLogItem],
        *,
        scope: HighlightScope,
        round_number: int | None = None,
    ) -> list[HighlightItem]:
        if scope == "round" and round_number is None:
            raise ValueError("round_number is required when scope=round")
        candidates = self._build_candidates(logs)
        if scope == "round":
            candidates = [
                candidate for candidate in candidates if candidate.item.round_number == round_number
            ]
            limit = ROUND_HIGHLIGHT_LIMIT
        else:
            limit = GAME_HIGHLIGHT_LIMIT
        selected = self._select_diverse(candidates, limit=limit)
        return [
            candidate.item
            for candidate in sorted(selected, key=lambda candidate: candidate.sort_key)
        ]

    def _build_candidates(self, logs: list[EventLogItem]) -> list[HighlightCandidate]:
        candidates: list[HighlightCandidate] = []
        round_end_logs: dict[int, EventLogItem] = {}
        initial_resources = self._initial_resources(logs)
        for index, item in enumerate(logs):
            candidates.extend(self._event_candidates(item, index))
            if item.type == "round_end" and item.round_number is not None:
                round_end_logs[item.round_number] = item

        previous_resources = initial_resources
        previous_factions: dict[str, dict[str, Any]] = {}
        previous_suspicion: dict[str, dict[str, Any]] = {}
        for round_number in sorted(round_end_logs):
            item = round_end_logs[round_number]
            current_resources = self._resource_data(item.data)
            current_factions = self._faction_index(item.data)
            current_suspicion = self._suspicion_index(item.data)

            resource_candidate = self._resource_swing_candidate(
                item,
                previous_resources=previous_resources,
                current_resources=current_resources,
            )
            if resource_candidate is not None:
                candidates.append(resource_candidate)

            faction_candidate = self._faction_shift_candidate(
                item,
                previous_factions=previous_factions,
                current_factions=current_factions,
            )
            if faction_candidate is not None:
                candidates.append(faction_candidate)

            candidates.extend(
                self._suspicion_spike_candidates(
                    item,
                    previous_suspicion=previous_suspicion,
                    current_suspicion=current_suspicion,
                )
            )

            previous_resources = current_resources or previous_resources
            previous_factions = current_factions
            previous_suspicion = current_suspicion
        return candidates

    def _event_candidates(self, item: EventLogItem, index: int) -> list[HighlightCandidate]:
        candidates: list[HighlightCandidate] = []
        crisis = self._crisis_candidate(item, index)
        if crisis is not None:
            candidates.append(crisis)
        betrayal = self._betrayal_candidate(item, index)
        if betrayal is not None:
            candidates.append(betrayal)
        close_vote = self._close_vote_candidate(item, index)
        if close_vote is not None:
            candidates.append(close_vote)
        return candidates

    def _crisis_candidate(self, item: EventLogItem, index: int) -> HighlightCandidate | None:
        if item.type != "crisis_event" or item.round_number is None:
            return None
        crisis = self._crisis_payload(item.data)
        severity = str(crisis.get("severity", "low")).lower()
        score = CRISIS_SEVERITY_SCORES.get(severity, 6.0)
        return self._candidate(
            item=item,
            index=index,
            category="crisis",
            score=score,
            variety_key="crisis",
            summary=str(crisis.get("description") or item.summary),
            data={
                "severity": severity,
                "crisis_event": crisis,
            },
        )

    def _betrayal_candidate(self, item: EventLogItem, index: int) -> HighlightCandidate | None:
        if item.type != "agent_action" or item.round_number is None:
            return None
        requested_action = self._requested_action_type(item)
        resolved_action = self._resolved_action_type(item)
        if requested_action in SABOTAGE_ACTION_TYPES or resolved_action in SABOTAGE_ACTION_TYPES:
            score = 9.2 if resolved_action in SABOTAGE_ACTION_TYPES else 8.4
        elif requested_action in HOSTILE_ACTION_TYPES or resolved_action in HOSTILE_ACTION_TYPES:
            score = 8.0 if resolved_action in HOSTILE_ACTION_TYPES else 7.2
        else:
            return None
        return self._candidate(
            item=item,
            index=index,
            category="betrayal",
            score=score,
            variety_key="betrayal",
            summary=item.summary,
            data={
                "requested_action_type": requested_action,
                "resolved_action_type": resolved_action,
                "agent_id": item.agent_id,
                "target": item.data.get("target"),
                "suspicion_level": item.data.get("suspicion_level"),
            },
        )

    def _close_vote_candidate(self, item: EventLogItem, index: int) -> HighlightCandidate | None:
        if item.round_number is None:
            return None
        kind = self._event_kind(item)
        if kind not in {"meeting_result", "exile_vote"}:
            return None
        tally = item.data.get("tally")
        if not isinstance(tally, dict):
            return None
        try:
            counts = sorted((int(value) for value in tally.values()), reverse=True)
        except (TypeError, ValueError):
            return None
        if len(counts) < 2:
            return None
        margin = counts[0] - counts[1]
        if margin > 1:
            return None
        total_votes = sum(counts)
        if total_votes < 2:
            return None
        score = 6.6 if margin == 0 else 6.2
        return self._candidate(
            item=item,
            index=index,
            category="close_vote",
            score=score,
            variety_key="close_vote",
            summary=item.summary,
            data={
                "tally": tally,
                "margin": margin,
                "total_votes": total_votes,
                "passed": bool(item.data.get("passed") or item.data.get("enacted")),
            },
        )

    def _resource_swing_candidate(
        self,
        item: EventLogItem,
        *,
        previous_resources: dict[str, float],
        current_resources: dict[str, float],
    ) -> HighlightCandidate | None:
        if item.round_number is None or not current_resources:
            return None
        resource_delta = {
            resource: round(
                current_resources.get(resource, 0.0) - previous_resources.get(resource, 0.0),
                2,
            )
            for resource in current_resources
        }
        deltas = {resource: delta for resource, delta in resource_delta.items() if delta != 0}
        if not deltas:
            return None
        magnitude = sum(abs(delta) for delta in deltas.values())
        if magnitude < 2.0:
            return None
        summary = self._resource_summary(item.round_number, deltas)
        score = min(7.4, round(5.0 + magnitude * 0.35, 2))
        return self._candidate(
            item=item,
            index=10_000 + item.round_number,
            category="resource_swing",
            score=score,
            variety_key="resource_swing",
            summary=summary,
            data={
                "resource_delta": deltas,
                "resources": current_resources,
                "previous_resources": previous_resources,
            },
        )

    def _faction_shift_candidate(
        self,
        item: EventLogItem,
        *,
        previous_factions: dict[str, dict[str, Any]],
        current_factions: dict[str, dict[str, Any]],
    ) -> HighlightCandidate | None:
        if item.round_number is None:
            return None
        formed = sorted(
            faction["name"]
            for faction_id, faction in current_factions.items()
            if faction_id not in previous_factions
        )
        dissolved = sorted(
            faction["name"]
            for faction_id, faction in previous_factions.items()
            if faction_id not in current_factions
        )
        joined: list[str] = []
        left: list[str] = []
        for faction_id, faction in current_factions.items():
            previous_members = set(previous_factions.get(faction_id, {}).get("member_ids", []))
            current_members = set(faction.get("member_ids", []))
            joined.extend(
                sorted(str(member_id) for member_id in current_members - previous_members)
            )
            left.extend(sorted(str(member_id) for member_id in previous_members - current_members))
        change_count = len(formed) + len(dissolved) + len(joined) + len(left)
        if change_count == 0:
            return None
        summary = self._faction_summary(item.round_number, formed, dissolved, joined, left)
        score = min(7.1, round(5.2 + change_count * 0.45, 2))
        return self._candidate(
            item=item,
            index=20_000 + item.round_number,
            category="alliance_shift",
            score=score,
            variety_key="alliance_shift",
            summary=summary,
            data={
                "formed_factions": formed,
                "dissolved_factions": dissolved,
                "joined_agent_ids": joined,
                "left_agent_ids": left,
                "factions": list(current_factions.values()),
            },
        )

    def _suspicion_spike_candidates(
        self,
        item: EventLogItem,
        *,
        previous_suspicion: dict[str, dict[str, Any]],
        current_suspicion: dict[str, dict[str, Any]],
    ) -> list[HighlightCandidate]:
        candidates: list[HighlightCandidate] = []
        if item.round_number is None:
            return candidates
        for agent_id, current in current_suspicion.items():
            previous = previous_suspicion.get(agent_id)
            if previous is None:
                continue
            delta = round(float(current["suspicion_level"]) - float(previous["suspicion_level"]), 2)
            if delta < 8.0:
                continue
            score = min(7.0, round(5.1 + delta * 0.12, 2))
            candidates.append(
                self._candidate(
                    item=item,
                    index=30_000 + item.round_number,
                    category="suspicion_spike",
                    score=score,
                    variety_key="suspicion_spike",
                    id_suffix=agent_id,
                    summary=(
                        f"{current['agent_name']} draws a surge of suspicion in round "
                        f"{item.round_number} (+{delta:.1f})."
                    ),
                    data={
                        "agent_id": agent_id,
                        "agent_name": current["agent_name"],
                        "suspicion_level": current["suspicion_level"],
                        "previous_suspicion_level": previous["suspicion_level"],
                        "delta": delta,
                    },
                )
            )
        return candidates

    def _select_diverse(
        self, candidates: list[HighlightCandidate], *, limit: int
    ) -> list[HighlightCandidate]:
        ordered = sorted(candidates, key=lambda candidate: candidate.sort_key)
        if len(ordered) <= limit:
            return ordered

        selected: list[HighlightCandidate] = []
        seen_variety: set[HighlightCategory] = set()
        for candidate in ordered:
            if candidate.variety_key in seen_variety:
                continue
            selected.append(candidate)
            seen_variety.add(candidate.variety_key)
            if len(selected) == limit:
                return selected

        if len(selected) < limit:
            selected_ids = {candidate.item.id for candidate in selected}
            for candidate in ordered:
                if candidate.item.id in selected_ids:
                    continue
                selected.append(candidate)
                selected_ids.add(candidate.item.id)
                if len(selected) == limit:
                    break
        return selected

    def _candidate(
        self,
        *,
        item: EventLogItem,
        index: int,
        category: HighlightCategory,
        score: float,
        variety_key: HighlightCategory,
        id_suffix: str | None = None,
        summary: str,
        data: dict[str, Any],
    ) -> HighlightCandidate:
        assert item.round_number is not None
        event_kind = self._event_kind(item)
        highlight = HighlightItem(
            id=(
                f"{item.id}:{category}:{id_suffix}"
                if id_suffix is not None
                else f"{item.id}:{category}"
            ),
            round_number=item.round_number,
            phase=item.phase,
            score=round(score, 2),
            category=category,
            event_type=item.type,
            event_kind=event_kind,
            summary=summary,
            data=data,
        )
        return HighlightCandidate(
            item=highlight,
            variety_key=variety_key,
            sort_key=(
                -highlight.score,
                highlight.round_number,
                self._phase_sort_key(highlight.phase),
                index,
            ),
        )

    def _event_kind(self, item: EventLogItem) -> str | None:
        kind = item.data.get("kind")
        return kind if isinstance(kind, str) else None

    def _crisis_payload(self, data: dict[str, Any]) -> dict[str, Any]:
        crisis = data.get("crisis_event")
        return crisis if isinstance(crisis, dict) else {}

    def _requested_action_type(self, item: EventLogItem) -> str | None:
        requested_action = item.data.get("requested_action_type")
        return requested_action if isinstance(requested_action, str) else None

    def _resolved_action_type(self, item: EventLogItem) -> str | None:
        resolved_action = item.data.get("resolved_action_type")
        if isinstance(resolved_action, str):
            return resolved_action
        action_type = item.data.get("action_type")
        return action_type if isinstance(action_type, str) else None

    def _resource_data(self, data: dict[str, Any]) -> dict[str, float]:
        resources = data.get("resources")
        if not isinstance(resources, dict):
            return {}
        return {
            resource: float(value)
            for resource, value in resources.items()
            if isinstance(resource, str) and isinstance(value, (int, float))
        }

    def _initial_resources(self, logs: list[EventLogItem]) -> dict[str, float]:
        for item in logs:
            if item.type != "experiment_created":
                continue
            resources = self._resource_data(item.data)
            if resources:
                return resources
            world_state = item.data.get("world_state")
            if isinstance(world_state, dict):
                resources = self._resource_data(world_state)
                if resources:
                    return resources
        return {}

    def _faction_index(self, data: dict[str, Any]) -> dict[str, dict[str, Any]]:
        factions = data.get("factions")
        if not isinstance(factions, list):
            return {}
        indexed: dict[str, dict[str, Any]] = {}
        for faction in factions:
            if not isinstance(faction, dict):
                continue
            faction_id = faction.get("faction_id")
            if not isinstance(faction_id, str):
                continue
            indexed[faction_id] = {
                "faction_id": faction_id,
                "name": str(faction.get("name") or faction_id),
                "member_ids": [str(member_id) for member_id in faction.get("member_ids", [])],
            }
        return indexed

    def _suspicion_index(self, data: dict[str, Any]) -> dict[str, dict[str, Any]]:
        suspicion = data.get("suspicion")
        if not isinstance(suspicion, list):
            return {}
        indexed: dict[str, dict[str, Any]] = {}
        for entry in suspicion:
            if not isinstance(entry, dict):
                continue
            agent_id = entry.get("agent_id")
            agent_name = entry.get("agent_name")
            suspicion_level = entry.get("suspicion_level")
            if not isinstance(agent_id, str) or not isinstance(agent_name, str):
                continue
            if not isinstance(suspicion_level, (int, float)):
                continue
            indexed[agent_id] = {
                "agent_name": agent_name,
                "suspicion_level": float(suspicion_level),
            }
        return indexed

    def _resource_summary(self, round_number: int, deltas: dict[str, float]) -> str:
        # Keep the reel copy compact by only naming the two largest shifts.
        major_changes = sorted(deltas.items(), key=lambda item: abs(item[1]), reverse=True)[:2]
        changes = ", ".join(
            f"{resource} {'+' if delta > 0 else ''}{delta:g}" for resource, delta in major_changes
        )
        return f"Round {round_number} jolts the resource balance: {changes}."

    def _faction_summary(
        self,
        round_number: int,
        formed: list[str],
        dissolved: list[str],
        joined: list[str],
        left: list[str],
    ) -> str:
        if formed:
            return f"Round {round_number} forges {', '.join(formed[:2])} into the political map."
        if dissolved:
            return f"Round {round_number} fractures {', '.join(dissolved[:2])}."
        if joined or left:
            return (
                f"Round {round_number} scrambles faction loyalties with "
                f"{len(joined)} joins and {len(left)} departures."
            )
        return f"Round {round_number} reshapes the alliance map."

    def _phase_sort_key(self, phase: str | None) -> int:
        return PHASE_ORDER.get(phase or "", 99)
