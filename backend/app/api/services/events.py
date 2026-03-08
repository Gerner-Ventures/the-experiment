from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.api.models import EventLogItem, EventLogType
from app.api.store import ExperimentStore
from app.engine import RoundResult, SimulationState

from .runtime_support import (
    COOPERATIVE_ACTION_TYPES,
    SABOTAGE_ACTION_TYPES,
    is_betrayal_action,
    status_value,
)


class RuntimeEventLogService:
    def __init__(self, *, store: ExperimentStore) -> None:
        self.store = store

    async def log(
        self,
        experiment_id: str,
        *,
        event_type: EventLogType,
        summary: str,
        round_number: int | None = None,
        phase: str | None = None,
        agent_id: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        await self.store.append_log(
            EventLogItem(
                id=str(uuid.uuid4()),
                experiment_id=experiment_id,
                round_number=round_number,
                phase=phase,
                agent_id=agent_id,
                type=event_type,
                summary=summary,
                data=data or {},
                timestamp=datetime.now(UTC),
            )
        )

    async def log_round_result(
        self,
        experiment_id: str,
        round_result: RoundResult,
        state: SimulationState,
    ) -> None:
        kind_to_type: dict[str, EventLogType] = {
            "faction_update": "faction_update",
            "cult_activity": "cult_activity",
            "exile_vote": "exile_vote",
            "exile_enacted": "exile_enacted",
        }
        for phase in round_result.phases:
            for event in phase.events:
                kind = str(event.data.get("kind", ""))
                if kind == "agent_action":
                    continue
                event_type = kind_to_type.get(kind, event.phase) if kind else event.phase
                if event_type == "dawn" and isinstance(event.data.get("crisis_event"), dict):
                    event_type = "crisis_event"
                await self.log(
                    experiment_id,
                    event_type=event_type,
                    summary=event.summary,
                    round_number=round_result.round_number,
                    phase=event.phase,
                    data=event.data,
                )
        for action in round_result.action_resolutions:
            await self.log(
                experiment_id,
                event_type="agent_action",
                summary=action.summary,
                round_number=round_result.round_number,
                phase=action.phase,
                agent_id=action.agent_id,
                data=action.model_dump(mode="json"),
            )
            if action.resolved_action_type == "move":
                await self.log(
                    experiment_id,
                    event_type="agent_move",
                    summary=f"{action.agent_name} moves to {action.location}.",
                    round_number=round_result.round_number,
                    phase=action.phase,
                    agent_id=action.agent_id,
                    data={"agent_id": action.agent_id, "location": action.location},
                )
        await self.log(
            experiment_id,
            event_type="resource_update",
            summary="Resources update at the end of the round.",
            round_number=round_result.round_number,
            data=round_result.world_state.resources.model_dump(mode="json"),
        )
        await self.log(
            experiment_id,
            event_type="threat_update",
            summary="Threat settles after the round resolves.",
            round_number=round_result.round_number,
            data={"threat_level": state.world_state.threat_level},
        )
        round_summary = self.build_round_summary(state, round_result)
        await self.log(
            experiment_id,
            event_type="round_end",
            summary=str(
                round_summary.get("summary", f"Round {round_result.round_number} concluded.")
            ),
            round_number=round_result.round_number,
            data=round_summary,
        )

    def build_round_summary(
        self, state: SimulationState, round_result: RoundResult
    ) -> dict[str, Any]:
        agents_by_id = {agent.agent_id: agent for agent in state.agents}
        decisional_actions = [
            action for action in round_result.action_resolutions if not action.is_consequence
        ]
        total_actions = len(decisional_actions)
        cooperative_actions = sum(
            1
            for action in decisional_actions
            if action.resolved_action_type in COOPERATIVE_ACTION_TYPES
        )
        cooperation_score = round(cooperative_actions / total_actions, 2) if total_actions else 0.0
        betrayal_count = sum(
            1
            for action in decisional_actions
            if is_betrayal_action(action.requested_action_type, action.resolved_action_type)
        )
        betrayal_count += sum(
            1
            for phase in round_result.phases
            for event in phase.events
            if event.data.get("kind") in {"exile_vote", "exile_enacted"}
        )
        sabotage_count = sum(
            1
            for action in decisional_actions
            if action.requested_action_type in SABOTAGE_ACTION_TYPES
            or action.resolved_action_type in SABOTAGE_ACTION_TYPES
        )
        dominant_faction = max(state.factions, key=lambda faction: faction.influence, default=None)
        goal_progress: list[dict[str, Any]] = []
        for action in decisional_actions:
            agent = agents_by_id.get(action.agent_id)
            goal_progress.append(
                {
                    "agent_id": action.agent_id,
                    "agent_name": action.agent_name,
                    "goal_text": agent.goal.text if agent is not None else "",
                    "goal_archetype": agent.goal.archetype if agent is not None else "",
                    "status": status_value(agent.status) if agent is not None else "",
                    "goal_progress": action.goal_progress,
                    "requested_action_type": action.requested_action_type,
                    "resolved_action_type": action.resolved_action_type,
                    "cooperation_intent": action.cooperation_intent,
                    "phase": action.phase,
                    "summary": action.summary,
                }
            )
        return {
            "summary": (
                f"Round {round_result.round_number} closes with cooperation "
                f"{cooperation_score:.2f} and threat {state.world_state.threat_level:.2f}."
            ),
            "gm": {
                "round_theme": round_result.gm_plan.plan.round_theme,
                "narration": round_result.gm_plan.plan.narration,
                "crisis_event": round_result.gm_plan.plan.crisis_event.model_dump(mode="json"),
            },
            "cooperation": {
                "score": cooperation_score,
                "cooperative_actions": cooperative_actions,
                "total_actions": total_actions,
            },
            "betrayal_count": betrayal_count,
            "sabotage_count": sabotage_count,
            "threat_level": state.world_state.threat_level,
            "resources": round_result.world_state.resources.model_dump(mode="json"),
            "dominant_faction": dominant_faction.name if dominant_faction is not None else None,
            "factions": [faction.model_dump(mode="json") for faction in state.factions],
            "suspicion": [
                {
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "suspicion_level": agent.suspicion_level,
                }
                for agent in state.agents
            ],
            "goal_progress": goal_progress,
        }
