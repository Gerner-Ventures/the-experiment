from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from typing import Any

from app.api.models import (
    AnalyticsSummary,
    AgentGoalProgress,
    AgentSuspicionHistory,
    BetrayalTimelineItem,
    EventLogItem,
    FactionAnalytics,
    FactionMembershipChange,
    FactionTimelinePoint,
    GMRoundTimelineItem,
    GoalOutcomeSummary,
    HighlightItem,
    HighlightScope,
    RelationshipEdge,
    ReplayIndex,
    ReplayRound,
    RoundAnalyticsItem,
    RoundSnapshotResponse,
    SuspicionAnalytics,
    SuspicionHistoryPoint,
    SuspicionPoint,
    UsageGroup,
    UsageReport,
)
from app.api.store import ExperimentStore
from app.db.models import AgentStatus
from app.engine import SimulationState
from app.highlights import HighlightSelector
from app.llm import UsageRecord, UsageSummary

from .runtime_support import (
    COOPERATIVE_ACTION_TYPES,
    HOSTILE_ACTION_TYPES,
    SABOTAGE_ACTION_TYPES,
    cooperation_data,
    crisis_event_data,
    dominant_faction_name,
    faction_data,
    faction_kind,
    float_value,
    goal_outcome,
    goal_progress_index,
    is_betrayal_action,
    is_consequence_action,
    phase_sort_key,
    requested_action_type,
    resolved_action_type,
    resource_data,
    round_summary_data,
    status_value,
    string_or,
    string_value,
    suspicion_data,
)


class RuntimeAnalyticsService:
    def __init__(
        self,
        *,
        store: ExperimentStore,
        highlight_selector: HighlightSelector,
        llm_trackers_getter: Callable[[], list[Any]],
    ) -> None:
        self.store = store
        self.highlight_selector = highlight_selector
        self._llm_trackers_getter = llm_trackers_getter

    async def get_usage_report(
        self,
        experiment_id: str,
        *,
        round_number: int | None = None,
        agent_id: str | None = None,
    ) -> UsageReport:
        records = self._usage_records(
            experiment_id=experiment_id,
            round_number=round_number,
            agent_id=agent_id,
        )
        return UsageReport(
            summary=self._summarize_usage_records(records),
            by_role=self._group_usage(records, "role", label_prefix="Role"),
            by_model=self._group_usage(records, "model", label_prefix="Model"),
            by_agent=self._group_usage(records, "agent_id", label_prefix="Agent"),
            by_round=self._group_usage(records, "round_number", label_prefix="Round"),
        )

    async def get_prompt_traces(
        self,
        experiment_id: str,
        *,
        limit: int,
        offset: int,
        round_number: int | None = None,
        agent_id: str | None = None,
        role: str | None = None,
    ) -> tuple[list[UsageRecord], int]:
        records = self._usage_records(
            experiment_id=experiment_id,
            round_number=round_number,
            agent_id=agent_id,
            role=role,
        )
        total = len(records)
        return records[offset : offset + limit], total

    async def get_analytics_summary(
        self,
        experiment_id: str,
        *,
        state: SimulationState,
    ) -> AnalyticsSummary:
        active_agents = [
            agent
            for agent in state.agents
            if agent.status not in {AgentStatus.EXILED, AgentStatus.DEAD}
        ]
        dominant_faction = max(state.factions, key=lambda faction: faction.influence, default=None)
        cooperation_score = await self._cooperation_score(experiment_id)
        return AnalyticsSummary(
            experiment_id=experiment_id,
            rounds_completed=state.current_round,
            active_agents=len(active_agents),
            exiled_agents=len(state.exile_history),
            faction_count=len(state.factions),
            cult_count=sum(1 for faction in state.factions if faction.kind == "cult"),
            cooperation_score=cooperation_score,
            threat_level=state.world_state.threat_level,
            dominant_faction=dominant_faction.name if dominant_faction is not None else None,
            current_resources=state.world_state.resources.model_dump(mode="json"),
        )

    async def get_round_analytics(self, experiment_id: str) -> list[RoundAnalyticsItem]:
        logs = await self.store.list_logs(experiment_id)
        round_summaries = round_summary_data(logs)
        items: list[RoundAnalyticsItem] = []
        for round_number, data in sorted(round_summaries.items()):
            cooperation = cooperation_data(data)
            items.append(
                RoundAnalyticsItem(
                    round_number=round_number,
                    summary=str(data.get("summary", f"Round {round_number} concluded.")),
                    gm_round_theme=str(data.get("gm", {}).get("round_theme", "")),
                    gm_narration=str(data.get("gm", {}).get("narration", "")),
                    crisis_event=crisis_event_data(data),
                    cooperation_score=cooperation["score"],
                    cooperative_actions=cooperation["cooperative_actions"],
                    total_actions=cooperation["total_actions"],
                    betrayal_count=int(data.get("betrayal_count", 0)),
                    sabotage_count=int(data.get("sabotage_count", 0)),
                    threat_level=float_value(data.get("threat_level")),
                    resources=resource_data(data),
                    faction_count=len(faction_data(data)),
                    dominant_faction=dominant_faction_name(data),
                )
            )
        return items

    async def get_goal_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState,
    ) -> list[GoalOutcomeSummary]:
        round_summaries = round_summary_data(await self.store.list_logs(experiment_id))
        goal_progress_by_round = {
            round_number: goal_progress_index(data)
            for round_number, data in round_summaries.items()
        }
        items: list[GoalOutcomeSummary] = []
        for agent in sorted(state.agents, key=lambda item: item.name):
            history: list[AgentGoalProgress] = []
            for round_number, goal_records in sorted(goal_progress_by_round.items()):
                for goal_record in goal_records.get(agent.agent_id, []):
                    progress = goal_record.get("goal_progress")
                    if not isinstance(progress, str) or not progress:
                        continue
                    history.append(
                        AgentGoalProgress(
                            round_number=round_number,
                            phase=goal_record.get("phase")
                            if isinstance(goal_record.get("phase"), str)
                            else None,
                            requested_action_type=str(
                                goal_record.get("requested_action_type", "observe")
                            ),
                            resolved_action_type=str(
                                goal_record.get("resolved_action_type", "observe")
                            ),
                            cooperation_intent=str(goal_record.get("cooperation_intent", "none")),
                            progress=progress,
                            summary=str(goal_record.get("summary", progress)),
                        )
                    )
            latest_progress = history[-1].progress if history else None
            items.append(
                GoalOutcomeSummary(
                    agent_id=agent.agent_id,
                    agent_name=agent.name,
                    goal_text=agent.goal.text,
                    goal_archetype=agent.goal.archetype,
                    status=agent.status,
                    outcome=goal_outcome(status_value(agent.status), history),
                    latest_progress=latest_progress,
                    progress_history=history,
                )
            )
        return items

    async def get_betrayal_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState,
    ) -> list[BetrayalTimelineItem]:
        agent_names = {agent.agent_id: agent.name for agent in state.agents}
        logs = await self.store.list_logs(experiment_id)
        items: list[BetrayalTimelineItem] = []
        for item in logs:
            if item.type == "agent_action":
                requested_action = requested_action_type(item)
                resolved_action = resolved_action_type(item)
                agent_id = item.agent_id or string_or(item.data.get("agent_id"))
                agent_name = agent_names.get(
                    agent_id,
                    string_or(item.data.get("agent_name")),
                )
                if (
                    requested_action in SABOTAGE_ACTION_TYPES
                    or resolved_action in SABOTAGE_ACTION_TYPES
                ):
                    items.append(
                        BetrayalTimelineItem(
                            round_number=item.round_number or 0,
                            phase=item.phase,
                            category="sabotage",
                            summary=item.summary,
                            agent_id=agent_id or None,
                            agent_name=agent_name,
                            requested_action_type=requested_action,
                            resolved_action_type=resolved_action,
                            resolved=resolved_action in SABOTAGE_ACTION_TYPES,
                        )
                    )
                elif is_betrayal_action(requested_action, resolved_action):
                    target_value = string_value(item.data.get("target"))
                    items.append(
                        BetrayalTimelineItem(
                            round_number=item.round_number or 0,
                            phase=item.phase,
                            category="hostile_action",
                            summary=item.summary,
                            agent_id=agent_id or None,
                            agent_name=agent_name,
                            target_agent_id=target_value,
                            target_agent_name=agent_names.get(target_value or "", target_value),
                            requested_action_type=requested_action,
                            resolved_action_type=resolved_action,
                            resolved=resolved_action in HOSTILE_ACTION_TYPES,
                        )
                    )
            elif item.type == "exile_vote":
                target_agent_id = string_value(item.data.get("target_agent_id"))
                target_agent_name = string_value(item.data.get("target_agent_name"))
                votes = item.data.get("votes", {})
                if isinstance(votes, dict):
                    for agent_id, vote in votes.items():
                        if vote != "banish":
                            continue
                        items.append(
                            BetrayalTimelineItem(
                                round_number=item.round_number or 0,
                                phase=item.phase,
                                category="exile_vote",
                                summary=item.summary,
                                agent_id=str(agent_id),
                                agent_name=agent_names.get(str(agent_id)),
                                target_agent_id=target_agent_id,
                                target_agent_name=target_agent_name,
                            )
                        )
            elif item.type == "exile_enacted":
                items.append(
                    BetrayalTimelineItem(
                        round_number=item.round_number or 0,
                        phase=item.phase,
                        category="exile_enacted",
                        summary=item.summary,
                        target_agent_id=string_value(item.data.get("target_agent_id")),
                        target_agent_name=string_value(item.data.get("target_agent_name")),
                    )
                )
        return sorted(
            items,
            key=lambda entry: (
                entry.round_number,
                phase_sort_key(entry.phase),
                entry.summary,
            ),
        )

    async def get_suspicion_analytics(self, experiment_id: str) -> SuspicionAnalytics:
        round_summaries = round_summary_data(await self.store.list_logs(experiment_id))
        heatmap: list[SuspicionPoint] = []
        grouped: defaultdict[str, list[SuspicionHistoryPoint]] = defaultdict(list)
        agent_names: dict[str, str] = {}
        for round_number, data in sorted(round_summaries.items()):
            for entry in suspicion_data(data):
                agent_id = string_or(entry.get("agent_id"))
                agent_name = string_or(entry.get("agent_name"))
                point = SuspicionPoint(
                    round_number=round_number,
                    agent_id=agent_id,
                    agent_name=agent_name,
                    suspicion_level=float_value(entry.get("suspicion_level")),
                )
                heatmap.append(point)
                agent_names[agent_id] = agent_name
                grouped[agent_id].append(
                    SuspicionHistoryPoint(
                        round_number=round_number,
                        suspicion_level=point.suspicion_level,
                    )
                )
        agents = [
            AgentSuspicionHistory(
                agent_id=agent_id,
                agent_name=agent_names.get(agent_id, ""),
                points=points,
            )
            for agent_id, points in sorted(
                grouped.items(),
                key=lambda item: agent_names.get(item[0], ""),
            )
        ]
        return SuspicionAnalytics(heatmap=heatmap, agents=agents)

    async def get_faction_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState,
    ) -> FactionAnalytics:
        round_summaries = round_summary_data(await self.store.list_logs(experiment_id))
        timeline: list[FactionTimelinePoint] = []
        membership_changes: list[FactionMembershipChange] = []
        previous_members: dict[str, set[str]] = {}
        previous_names: dict[str, str] = {}
        for round_number, data in sorted(round_summaries.items()):
            current_members: dict[str, set[str]] = {}
            current_names: dict[str, str] = {}
            for entry in faction_data(data):
                faction_id = string_or(entry.get("faction_id"))
                faction_name = string_or(entry.get("name"))
                members = {str(member_id) for member_id in entry.get("member_ids", [])}
                current_members[faction_id] = members
                current_names[faction_id] = faction_name
                timeline.append(
                    FactionTimelinePoint(
                        round_number=round_number,
                        faction_id=faction_id,
                        faction_name=faction_name,
                        kind=faction_kind(entry.get("kind")),
                        pressure=float_value(entry.get("pressure")),
                        influence=float_value(entry.get("influence")),
                        member_ids=sorted(members),
                    )
                )
                joined = sorted(members - previous_members.get(faction_id, set()))
                left = sorted(previous_members.get(faction_id, set()) - members)
                if joined or left or faction_id not in previous_members:
                    membership_changes.append(
                        FactionMembershipChange(
                            round_number=round_number,
                            faction_id=faction_id,
                            faction_name=faction_name,
                            joined_agent_ids=joined,
                            left_agent_ids=left,
                        )
                    )
            for faction_id, members in previous_members.items():
                if faction_id in current_members or not members:
                    continue
                membership_changes.append(
                    FactionMembershipChange(
                        round_number=round_number,
                        faction_id=faction_id,
                        faction_name=previous_names.get(faction_id, faction_id),
                        joined_agent_ids=[],
                        left_agent_ids=sorted(members),
                    )
                )
            previous_members = current_members
            previous_names = current_names
        return FactionAnalytics(
            items=state.factions,
            timeline=timeline,
            membership_changes=membership_changes,
        )

    async def get_gm_timeline(self, experiment_id: str) -> list[GMRoundTimelineItem]:
        round_summaries = round_summary_data(await self.store.list_logs(experiment_id))
        return [
            GMRoundTimelineItem(
                round_number=round_number,
                round_theme=string_or(data.get("gm", {}).get("round_theme")),
                narration=string_or(data.get("gm", {}).get("narration")),
                crisis_event=crisis_event_data(data),
            )
            for round_number, data in sorted(round_summaries.items())
        ]

    async def get_relationship_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState,
    ) -> list[RelationshipEdge]:
        del experiment_id
        agents = {agent.agent_id: agent for agent in state.agents}
        edges: list[RelationshipEdge] = []
        for source in state.agents:
            for target_id, relationship in source.relationships.items():
                target = agents.get(target_id)
                if target is None:
                    continue
                edges.append(
                    RelationshipEdge(
                        source_agent_id=source.agent_id,
                        source_agent_name=source.name,
                        target_agent_id=target_id,
                        target_agent_name=target.name,
                        trust=relationship.trust,
                        faction_id=source.faction_id,
                    )
                )
        return sorted(edges, key=lambda item: abs(item.trust), reverse=True)

    async def get_highlights(
        self,
        experiment_id: str,
        *,
        scope: HighlightScope = "game",
        round_number: int | None = None,
        logs: list[EventLogItem] | None = None,
    ) -> list[HighlightItem]:
        event_logs = logs if logs is not None else await self.store.list_logs(experiment_id)
        return self.highlight_selector.select(event_logs, scope=scope, round_number=round_number)

    async def get_replay_index(self, experiment_id: str) -> ReplayIndex:
        logs = await self.store.list_logs(experiment_id)
        snapshots = await self.store.list_world_snapshots(experiment_id)
        round_summaries = round_summary_data(logs)
        rounds: list[ReplayRound] = []
        for round_number, snapshot in snapshots:
            round_logs = [item for item in logs if item.round_number == round_number]
            round_summary = round_summaries.get(round_number, {})
            summary = str(
                round_summary.get(
                    "summary",
                    round_logs[-1].summary if round_logs else f"Round {round_number} concluded.",
                )
            )
            threat_level = float_value(
                round_summary.get("threat_level", snapshot.get("threat_level", 0.0))
            )
            cooperation = cooperation_data(round_summary)
            rounds.append(
                ReplayRound(
                    round_number=round_number,
                    summary=summary,
                    threat_level=threat_level,
                    event_count=len(round_logs),
                    cooperation_score=cooperation["score"],
                    betrayal_count=int(round_summary.get("betrayal_count", 0)),
                    sabotage_count=int(round_summary.get("sabotage_count", 0)),
                    resources=resource_data(round_summary),
                    gm_round_theme=string_or(round_summary.get("gm", {}).get("round_theme")),
                    gm_narration=string_or(round_summary.get("gm", {}).get("narration")),
                )
            )
        return ReplayIndex(
            rounds=rounds,
            highlights=await self.get_highlights(experiment_id, scope="game", logs=logs),
        )

    async def get_round_snapshot(
        self, experiment_id: str, round_number: int
    ) -> RoundSnapshotResponse:
        snapshot = await self.store.load_world_snapshot(experiment_id, round_number)
        if snapshot is None:
            raise KeyError(round_number)
        logs = await self.store.list_logs(experiment_id)
        return RoundSnapshotResponse(
            experiment_id=experiment_id,
            round_number=round_number,
            snapshot=snapshot,
            events=[item for item in logs if item.round_number == round_number],
        )

    async def _cooperation_score(self, experiment_id: str) -> float:
        logs = await self.store.list_logs(experiment_id)
        agent_actions = [item for item in logs if item.type == "agent_action"]
        if not agent_actions:
            round_summaries = round_summary_data(logs)
            if not round_summaries:
                return 0.0
            total_actions = 0
            cooperative = 0
            for data in round_summaries.values():
                cooperation = cooperation_data(data)
                total_actions += cooperation["total_actions"]
                cooperative += cooperation["cooperative_actions"]
            return round(cooperative / total_actions, 2) if total_actions else 0.0
        cooperative = sum(
            1
            for item in agent_actions
            if not is_consequence_action(item)
            and resolved_action_type(item) in COOPERATIVE_ACTION_TYPES
        )
        decisional_actions = sum(1 for item in agent_actions if not is_consequence_action(item))
        return round(cooperative / decisional_actions, 2) if decisional_actions else 0.0

    def _usage_records(
        self,
        *,
        experiment_id: str,
        round_number: int | None = None,
        agent_id: str | None = None,
        role: str | None = None,
    ) -> list[UsageRecord]:
        records: list[UsageRecord] = []
        for tracker in self._llm_trackers_getter():
            for record in tracker.list_records(
                experiment_id=experiment_id,
                round_number=round_number,
                agent_id=agent_id,
                role=role,
            ):
                records.append(record)
        return sorted(records, key=lambda item: item.created_at, reverse=True)

    def _summarize_usage_records(self, records: list[UsageRecord]) -> UsageSummary:
        summary = UsageSummary()
        for record in records:
            summary.request_count += 1
            summary.prompt_tokens += record.usage.prompt_tokens
            summary.completion_tokens += record.usage.completion_tokens
            summary.total_tokens += record.usage.total_tokens
            summary.cost_usd = round(summary.cost_usd + record.usage.cost_usd, 6)
        return summary

    def _group_usage(
        self,
        records: list[UsageRecord],
        field_name: str,
        *,
        label_prefix: str,
    ) -> list[UsageGroup]:
        grouped: dict[str, UsageGroup] = {}
        for record in records:
            raw_value = getattr(record, field_name)
            key = str(raw_value) if raw_value is not None else "unknown"
            group = grouped.setdefault(
                key,
                UsageGroup(
                    key=key,
                    label=f"{label_prefix} {key}",
                ),
            )
            group.request_count += 1
            group.prompt_tokens += record.usage.prompt_tokens
            group.completion_tokens += record.usage.completion_tokens
            group.total_tokens += record.usage.total_tokens
            group.cost_usd = round(group.cost_usd + record.usage.cost_usd, 6)
        return sorted(grouped.values(), key=lambda item: item.total_tokens, reverse=True)
