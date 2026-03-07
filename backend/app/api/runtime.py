from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any, Literal, TypedDict, cast

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder
from starlette.websockets import WebSocketState

from app.agents.models import AgentMemoryState
from app.api.models import (
    AnalyticsSummary,
    BetrayalTimelineItem,
    CreateExperimentRequest,
    EventLogItem,
    EventLogType,
    FactionAnalytics,
    FactionMembershipChange,
    FactionTimelinePoint,
    GMRoundTimelineItem,
    AgentGoalProgress,
    GoalOutcomeSummary,
    HighlightItem,
    RelationshipEdge,
    ReplayIndex,
    ReplayRound,
    RoundAnalyticsItem,
    RoundSnapshotResponse,
    SuspicionAnalytics,
    SuspicionHistoryPoint,
    SuspicionPoint,
    AgentSuspicionHistory,
    UsageGroup,
    UsageReport,
)
from app.api.store import ExperimentStore, SqlAlchemyExperimentStore
from app.db.models import AgentStatus
from app.db.session import AsyncSessionLocal
from app.engine import EngineAgentState, RoundResult, SimulationEngine, SimulationState
from app.gm import GMService, get_preset_arc
from app.gm.models import DirectorArc, GMPlanData, GMPlanRecord, GMPlanningContext
from app.llm import UsageRecord, UsageSummary
from app.schemas.ws_message import WSMessage, WSMessageType
from app.world import build_default_world_state, resolve_spawn_tile

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
logger = logging.getLogger(__name__)


class CooperationMetrics(TypedDict):
    score: float
    cooperative_actions: int
    total_actions: int


GoalOutcome = Literal["achieved", "partial", "failed", "unknown"]


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: defaultdict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, experiment_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[experiment_id].add(websocket)
        logger.info(
            "WS connected: experiment=%s total=%d",
            experiment_id,
            len(self.connections[experiment_id]),
        )

    def disconnect(self, experiment_id: str, websocket: WebSocket) -> None:
        # Use `.get()` here so disconnects for unknown experiments do not create empty buckets.
        sockets = self.connections.get(experiment_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            self.connections.pop(experiment_id, None)
        logger.info(
            "WS disconnected: experiment=%s remaining=%d",
            experiment_id,
            len(self.connections.get(experiment_id, ())),
        )

    async def broadcast(self, experiment_id: str, payload: dict[str, Any]) -> None:
        sockets = list(self.connections.get(experiment_id, ()))
        if not sockets:
            return
        encoded_payload = jsonable_encoder(payload)
        dead_sockets: list[WebSocket] = []
        for socket in sockets:
            try:
                if socket.client_state == WebSocketState.CONNECTED:
                    await socket.send_json(encoded_payload)
                else:
                    logger.warning(
                        "Pruning websocket during broadcast: experiment=%s state=%s",
                        experiment_id,
                        socket.client_state,
                    )
                    dead_sockets.append(socket)
            except Exception:
                logger.warning(
                    "Pruning websocket after send failure: experiment=%s",
                    experiment_id,
                    exc_info=True,
                )
                dead_sockets.append(socket)
        for socket in dead_sockets:
            self.disconnect(experiment_id, socket)


class ExperimentRuntime:
    def __init__(self, *, store: ExperimentStore | None = None) -> None:
        self.engine = SimulationEngine()
        self.gm_service = GMService()
        self.connection_manager = ConnectionManager()
        self.store = store or SqlAlchemyExperimentStore(AsyncSessionLocal)
        self.lock = asyncio.Lock()

    async def create_experiment(self, request: CreateExperimentRequest) -> SimulationState:
        async with self.lock:
            experiment_id = str(uuid.uuid4())
            arc = request.arc or get_preset_arc(request.preset_arc_id)
            agents: list[EngineAgentState] = []
            spawn_counts: dict[str, int] = {}
            for agent in request.agents:
                location = agent.location or "town_square"
                spawn_index = spawn_counts.get(location, 0)
                spawn_counts[location] = spawn_index + 1
                spawn_tile = resolve_spawn_tile(location, spawn_index=spawn_index)
                agents.append(
                    EngineAgentState(
                        agent_id=str(uuid.uuid4()),
                        name=agent.name,
                        character_id=agent.character_id,
                        personality=agent.personality,
                        goal=agent.goal,
                        memory=AgentMemoryState(),
                        location=location,
                        tile_x=spawn_tile[0],
                        tile_y=spawn_tile[1],
                        inventory=agent.inventory,
                        relationships={},
                        suspicion_level=0,
                        llm_model=agent.llm_model,
                    )
                )
            state = SimulationState(
                experiment_id=experiment_id,
                experiment_name=request.name,
                total_rounds=request.total_rounds,
                current_round=0,
                status="setup",
                auto_approve=request.auto_approve,
                arc=arc,
                world_state=build_default_world_state(),
                agents=agents,
            )
            await self.store.save_state(state)
            await self._log(
                experiment_id,
                event_type="experiment_created",
                summary=f"Experiment '{request.name}' created.",
            )
            return state

    async def get_state(self, experiment_id: str) -> SimulationState:
        return await self.store.load_state(experiment_id)

    async def start(self, experiment_id: str) -> SimulationState:
        state = await self.get_state(experiment_id)
        state.status = "running"
        await self.store.save_state(state)
        await self._log(
            experiment_id, event_type="experiment_started", summary="Experiment started."
        )
        return state

    async def pause(self, experiment_id: str) -> SimulationState:
        state = await self.get_state(experiment_id)
        state.status = "paused"
        await self.store.save_state(state)
        await self._log(experiment_id, event_type="experiment_paused", summary="Experiment paused.")
        return state

    async def inject_observer_event(self, experiment_id: str, description: str) -> SimulationState:
        state = await self.get_state(experiment_id)
        state.unresolved_plotlines.append(description)
        state.unresolved_plotlines = state.unresolved_plotlines[-10:]
        for agent in state.agents:
            agent.suspicion_level = min(100.0, agent.suspicion_level + 6.0)
        await self.store.save_state(state)
        await self._log(experiment_id, event_type="observer_event", summary=description)
        self._schedule_broadcast(
            experiment_id,
            self._message(
                "observer_event",
                round_number=state.current_round,
                data={"description": description},
            ),
        )
        return state

    async def update_arc(self, experiment_id: str, arc: DirectorArc) -> SimulationState:
        state = await self.get_state(experiment_id)
        state.arc = arc
        await self.store.save_state(state)
        await self._log(
            experiment_id, event_type="arc_updated", summary=f"Arc updated to '{arc.name}'."
        )
        return state

    async def get_or_generate_gm_plan(self, experiment_id: str) -> GMPlanRecord:
        state = await self.get_state(experiment_id)
        next_round = state.current_round + 1
        if state.gm_plan and state.gm_plan.plan.round == next_round:
            return state.gm_plan
        context = GMPlanningContext(
            experiment_id=experiment_id,
            round_number=next_round,
            total_rounds=state.total_rounds,
            arc=state.arc,
            world_state=state.world_state,
            threat_level=state.world_state.threat_level,
            cooperation_ratio=0.6,
            unresolved_plotlines=state.unresolved_plotlines,
            relationships_summary=self._relationship_summary(state),
            recent_events=state.recent_events[-5:],
            auto_approve=state.auto_approve,
        )
        plan = await self.gm_service.generate_plan(context)
        state.gm_plan = plan
        await self.store.save_state(state)
        await self._log(
            experiment_id,
            event_type="gm_plan_generated",
            summary=plan.plan.round_theme,
            round_number=next_round,
        )
        return plan

    async def approve_gm_plan(
        self, experiment_id: str, modified_plan: GMPlanData | None = None
    ) -> GMPlanRecord:
        state = await self.get_state(experiment_id)
        record = await self.get_or_generate_gm_plan(experiment_id)
        approved = self.gm_service.approve_plan(record, modified_plan=modified_plan)
        applied = self.gm_service.apply_plan(approved)
        state.gm_plan = applied
        await self.store.save_state(state)
        await self._log(
            experiment_id,
            event_type="gm_plan_approved",
            summary=applied.plan.round_theme,
            round_number=applied.plan.round,
        )
        return applied

    async def step(self, experiment_id: str) -> tuple[RoundResult, SimulationState]:
        async with self.lock:
            state = await self.get_state(experiment_id)
            if state.status == "setup":
                state.status = "running"
            if not state.auto_approve:
                record = await self.get_or_generate_gm_plan(experiment_id)
                approved = self.gm_service.approve_plan(record)
                state.gm_plan = self.gm_service.apply_plan(approved)
                await self.store.save_state(state)
                await self._log(
                    experiment_id,
                    event_type="gm_plan_approved",
                    summary=state.gm_plan.plan.round_theme,
                    round_number=state.gm_plan.plan.round,
                )
            round_result = await self.engine.run_round(state)
            await self.store.save_state(state)
            await self.store.record_round_result(experiment_id, round_result)
            await self._log_round_result(experiment_id, round_result, state)
        await self.broadcast_round(experiment_id, round_result)
        return round_result, state

    async def list_agents(self, experiment_id: str) -> list[EngineAgentState]:
        return (await self.get_state(experiment_id)).agents

    async def get_agent(self, experiment_id: str, agent_id: str) -> EngineAgentState:
        for agent in (await self.get_state(experiment_id)).agents:
            if agent.agent_id == agent_id:
                return agent
        raise KeyError(agent_id)

    async def get_log(
        self,
        experiment_id: str,
        *,
        limit: int,
        offset: int,
        phase: str | None = None,
        event_type: str | None = None,
        agent_id: str | None = None,
        round_number: int | None = None,
    ) -> tuple[list[EventLogItem], int]:
        items = await self.store.list_logs(experiment_id)
        filtered = [
            item
            for item in items
            if (phase is None or item.phase == phase)
            and (event_type is None or item.type == event_type)
            and (agent_id is None or item.agent_id == agent_id)
            and (round_number is None or item.round_number == round_number)
        ]
        return filtered[offset : offset + limit], len(filtered)

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
        state: SimulationState | None = None,
    ) -> AnalyticsSummary:
        state = state or await self.get_state(experiment_id)
        active_agents = [agent for agent in state.agents if agent.status != AgentStatus.EXILED]
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
        round_summaries = self._round_summary_data(logs)
        items: list[RoundAnalyticsItem] = []
        for round_number, data in sorted(round_summaries.items()):
            cooperation = self._cooperation_data(data)
            items.append(
                RoundAnalyticsItem(
                    round_number=round_number,
                    summary=str(data.get("summary", f"Round {round_number} concluded.")),
                    gm_round_theme=str(data.get("gm", {}).get("round_theme", "")),
                    gm_narration=str(data.get("gm", {}).get("narration", "")),
                    crisis_event=self._crisis_event_data(data),
                    cooperation_score=cooperation["score"],
                    cooperative_actions=cooperation["cooperative_actions"],
                    total_actions=cooperation["total_actions"],
                    betrayal_count=int(data.get("betrayal_count", 0)),
                    sabotage_count=int(data.get("sabotage_count", 0)),
                    threat_level=self._float_value(data.get("threat_level")),
                    resources=self._resource_data(data),
                    faction_count=len(self._faction_data(data)),
                    dominant_faction=self._dominant_faction_name(data),
                )
            )
        return items

    async def get_goal_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState | None = None,
    ) -> list[GoalOutcomeSummary]:
        state = state or await self.get_state(experiment_id)
        round_summaries = self._round_summary_data(await self.store.list_logs(experiment_id))
        goal_progress_by_round = {
            round_number: self._goal_progress_index(data)
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
                    outcome=self._goal_outcome(
                        self._status_value(agent.status), latest_progress, history
                    ),
                    latest_progress=latest_progress,
                    progress_history=history,
                )
            )
        return items

    async def get_betrayal_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState | None = None,
    ) -> list[BetrayalTimelineItem]:
        state = state or await self.get_state(experiment_id)
        agent_names = {agent.agent_id: agent.name for agent in state.agents}
        logs = await self.store.list_logs(experiment_id)
        items: list[BetrayalTimelineItem] = []
        for item in logs:
            if item.type == "agent_action":
                requested_action = self._requested_action_type(item)
                resolved_action = self._resolved_action_type(item)
                agent_id = item.agent_id or self._string_or(item.data.get("agent_id"))
                agent_name = agent_names.get(
                    agent_id,
                    self._string_or(item.data.get("agent_name")),
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
                elif (
                    requested_action in HOSTILE_ACTION_TYPES
                    or resolved_action in HOSTILE_ACTION_TYPES
                ):
                    target_value = self._string_value(item.data.get("target"))
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
                target_agent_id = self._string_value(item.data.get("target_agent_id"))
                target_agent_name = self._string_value(item.data.get("target_agent_name"))
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
                        target_agent_id=self._string_value(item.data.get("target_agent_id")),
                        target_agent_name=self._string_value(item.data.get("target_agent_name")),
                    )
                )
        return sorted(
            items,
            key=lambda entry: (
                entry.round_number,
                self._phase_sort_key(entry.phase),
                entry.summary,
            ),
        )

    async def get_suspicion_analytics(self, experiment_id: str) -> SuspicionAnalytics:
        round_summaries = self._round_summary_data(await self.store.list_logs(experiment_id))
        heatmap: list[SuspicionPoint] = []
        grouped: defaultdict[str, list[SuspicionHistoryPoint]] = defaultdict(list)
        agent_names: dict[str, str] = {}
        for round_number, data in sorted(round_summaries.items()):
            for entry in self._suspicion_data(data):
                agent_id = self._string_or(entry.get("agent_id"))
                agent_name = self._string_or(entry.get("agent_name"))
                point = SuspicionPoint(
                    round_number=round_number,
                    agent_id=agent_id,
                    agent_name=agent_name,
                    suspicion_level=self._float_value(entry.get("suspicion_level")),
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
        state: SimulationState | None = None,
    ) -> FactionAnalytics:
        state = state or await self.get_state(experiment_id)
        round_summaries = self._round_summary_data(await self.store.list_logs(experiment_id))
        timeline: list[FactionTimelinePoint] = []
        membership_changes: list[FactionMembershipChange] = []
        previous_members: dict[str, set[str]] = {}
        previous_names: dict[str, str] = {}
        for round_number, data in sorted(round_summaries.items()):
            current_members: dict[str, set[str]] = {}
            current_names: dict[str, str] = {}
            for entry in self._faction_data(data):
                faction_id = self._string_or(entry.get("faction_id"))
                faction_name = self._string_or(entry.get("name"))
                members = {str(member_id) for member_id in entry.get("member_ids", [])}
                current_members[faction_id] = members
                current_names[faction_id] = faction_name
                timeline.append(
                    FactionTimelinePoint(
                        round_number=round_number,
                        faction_id=faction_id,
                        faction_name=faction_name,
                        kind=self._string_or(entry.get("kind")),
                        pressure=self._float_value(entry.get("pressure")),
                        influence=self._float_value(entry.get("influence")),
                        member_ids=sorted(members),
                    )
                )
                joined = sorted(members - previous_members.get(faction_id, set()))
                left = sorted(previous_members.get(faction_id, set()) - members)
                # Treat the first observed round as an explicit formation event so
                # timeline consumers can render when a faction first appears.
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
        round_summaries = self._round_summary_data(await self.store.list_logs(experiment_id))
        return [
            GMRoundTimelineItem(
                round_number=round_number,
                round_theme=self._string_or(data.get("gm", {}).get("round_theme")),
                narration=self._string_or(data.get("gm", {}).get("narration")),
                crisis_event=self._crisis_event_data(data),
            )
            for round_number, data in sorted(round_summaries.items())
        ]

    async def get_relationship_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState | None = None,
    ) -> list[RelationshipEdge]:
        state = state or await self.get_state(experiment_id)
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

    async def get_highlights(self, experiment_id: str) -> list[HighlightItem]:
        logs = await self.store.list_logs(experiment_id)
        highlights: list[HighlightItem] = []
        for item in logs:
            score = self._highlight_score(item)
            if score <= 0:
                continue
            highlights.append(
                HighlightItem(
                    round_number=item.round_number,
                    score=score,
                    category=item.type,
                    summary=item.summary,
                    data=item.data,
                )
            )
        return sorted(highlights, key=lambda item: item.score, reverse=True)[:20]

    async def get_replay_index(self, experiment_id: str) -> ReplayIndex:
        logs = await self.store.list_logs(experiment_id)
        snapshots = await self.store.list_world_snapshots(experiment_id)
        round_summaries = self._round_summary_data(logs)
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
            threat_level = self._float_value(
                round_summary.get("threat_level", snapshot.get("threat_level", 0.0))
            )
            cooperation = self._cooperation_data(round_summary)
            rounds.append(
                ReplayRound(
                    round_number=round_number,
                    summary=summary,
                    threat_level=threat_level,
                    event_count=len(round_logs),
                    cooperation_score=cooperation["score"],
                    betrayal_count=int(round_summary.get("betrayal_count", 0)),
                    sabotage_count=int(round_summary.get("sabotage_count", 0)),
                    resources=self._resource_data(round_summary),
                    gm_round_theme=self._string_or(round_summary.get("gm", {}).get("round_theme")),
                    gm_narration=self._string_or(round_summary.get("gm", {}).get("narration")),
                )
            )
        return ReplayIndex(rounds=rounds, highlights=await self.get_highlights(experiment_id))

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

    async def broadcast_round(self, experiment_id: str, round_result: RoundResult) -> None:
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "round_start",
                round_number=round_result.round_number,
                data={"theme": round_result.gm_plan.plan.round_theme},
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "gm_plan",
                round_number=round_result.round_number,
                data=round_result.gm_plan.model_dump(mode="json"),
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "crisis_event",
                round_number=round_result.round_number,
                phase="dawn",
                data=round_result.gm_plan.plan.crisis_event.model_dump(mode="json"),
            ),
        )
        for phase in round_result.phases:
            await self.connection_manager.broadcast(
                experiment_id,
                self._message(
                    "phase_change",
                    round_number=round_result.round_number,
                    phase=phase.phase,
                    data={"events": [event.model_dump(mode="json") for event in phase.events]},
                ),
            )
            for event in phase.events:
                kind = event.data.get("kind")
                if kind == "agent_speak":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "agent_speak",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
                elif kind == "meeting_start":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "meeting_start",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
                elif kind == "meeting_speech":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "meeting_speech",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
                elif kind == "meeting_vote":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "meeting_vote",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
                elif kind == "meeting_result":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "meeting_result",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
                elif kind == "faction_update":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "faction_update",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
                elif kind == "cult_activity":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "cult_activity",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
                elif kind == "exile_vote":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "exile_vote",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
                elif kind == "exile_enacted":
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "exile_result",
                            round_number=round_result.round_number,
                            phase=phase.phase,
                            data=event.data,
                        ),
                    )
        for agent_id, turns in round_result.agent_turns.items():
            for turn in turns:
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message(
                        "agent_action",
                        round_number=round_result.round_number,
                        data={
                            "agent_id": agent_id,
                            "action": turn.decision.action.model_dump(mode="json"),
                            "cooperation_intent": turn.decision.cooperation_intent,
                            "goal_progress": turn.decision.goal_progress,
                        },
                    ),
                )
                if turn.decision.action.location:
                    await self.connection_manager.broadcast(
                        experiment_id,
                        self._message(
                            "agent_move",
                            round_number=round_result.round_number,
                            data={
                                "agent_id": agent_id,
                                "location": turn.decision.action.location,
                            },
                        ),
                    )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "resource_update",
                round_number=round_result.round_number,
                data=round_result.world_state.resources.model_dump(),
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "threat_update",
                round_number=round_result.round_number,
                data={"threat_level": round_result.threat_level},
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "round_end",
                round_number=round_result.round_number,
                data={
                    "threat_level": round_result.threat_level,
                    "resources": round_result.world_state.resources.model_dump(),
                },
            ),
        )
        state = await self.get_state(experiment_id)
        if round_result.round_number >= state.total_rounds:
            await self.connection_manager.broadcast(
                experiment_id,
                self._message(
                    "experiment_end",
                    round_number=round_result.round_number,
                    data={"status": state.status, "total_rounds": state.total_rounds},
                ),
            )

    def _relationship_summary(self, state: SimulationState) -> str:
        parts = []
        for agent in state.agents:
            if agent.relationships:
                parts.append(f"{agent.name} tracks {len(agent.relationships)} relationships.")
        return " ".join(parts) or "Relationships are still taking shape."

    async def _cooperation_score(self, experiment_id: str) -> float:
        logs = await self.store.list_logs(experiment_id)
        agent_actions = [item for item in logs if item.type == "agent_action"]
        if not agent_actions:
            # Backfill path for experiments created before explicit `agent_action`
            # rows were persisted alongside `round_end` analytics summaries.
            round_summaries = self._round_summary_data(logs)
            if not round_summaries:
                return 0.0
            total_actions = 0
            cooperative = 0
            for data in round_summaries.values():
                cooperation = self._cooperation_data(data)
                total_actions += cooperation["total_actions"]
                cooperative += cooperation["cooperative_actions"]
            return round(cooperative / total_actions, 2) if total_actions else 0.0
        cooperative = sum(
            1
            for item in agent_actions
            if self._resolved_action_type(item) in COOPERATIVE_ACTION_TYPES
        )
        return round(cooperative / len(agent_actions), 2)

    def _usage_records(
        self,
        *,
        experiment_id: str,
        round_number: int | None = None,
        agent_id: str | None = None,
        role: str | None = None,
    ) -> list[UsageRecord]:
        records: list[UsageRecord] = []
        for tracker in self._llm_trackers():
            for record in tracker.list_records(
                experiment_id=experiment_id,
                round_number=round_number,
                agent_id=agent_id,
                role=role,
            ):
                records.append(record)
        return sorted(records, key=lambda item: item.created_at, reverse=True)

    def _llm_trackers(self) -> list[Any]:
        trackers = []
        candidates = [
            getattr(getattr(self.gm_service, "llm_service", None), "client", None),
            getattr(getattr(self.engine.gm_service, "llm_service", None), "client", None),
            getattr(
                getattr(getattr(self.engine.agent_service, "brain", None), "llm_service", None),
                "client",
                None,
            ),
        ]
        seen_ids: set[int] = set()
        for client in candidates:
            tracker = getattr(client, "tracker", None)
            if tracker is None:
                continue
            tracker_id = id(tracker)
            if tracker_id in seen_ids:
                continue
            seen_ids.add(tracker_id)
            trackers.append(tracker)
        return trackers

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

    def _highlight_score(self, item: EventLogItem) -> float:
        if item.type == "exile_enacted":
            return 10.0
        if item.type == "cult_activity":
            return 8.0
        if item.type == "faction_update":
            return 6.0
        if item.type == "crisis_event":
            severity = str(item.data.get("crisis_event", {}).get("severity", "low"))
            return {"critical": 9.0, "high": 7.0, "medium": 5.0}.get(severity, 3.0)
        if item.type == "agent_action":
            requested_action = self._requested_action_type(item)
            resolved_action = self._resolved_action_type(item)
            if (
                requested_action in SABOTAGE_ACTION_TYPES
                or resolved_action in SABOTAGE_ACTION_TYPES
            ):
                return 8.0 if resolved_action in SABOTAGE_ACTION_TYPES else 5.0
            if requested_action in HOSTILE_ACTION_TYPES or resolved_action in HOSTILE_ACTION_TYPES:
                return 6.5 if resolved_action in HOSTILE_ACTION_TYPES else 4.0
        if item.type == "observer_event":
            return 7.0
        if item.type == "round_end":
            threat_level = float(item.data.get("threat_level", 0.0))
            return 5.5 if threat_level >= 65 else 0.0
        return 0.0

    def _message(
        self,
        message_type: WSMessageType,
        *,
        round_number: int,
        data: dict[str, Any],
        phase: str | None = None,
    ) -> dict[str, Any]:
        return WSMessage(
            type=message_type,
            round=round_number,
            phase=phase,
            timestamp=datetime.now(UTC),
            data=data,
        ).model_dump(mode="json")

    def _schedule_broadcast(self, experiment_id: str, payload: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self.connection_manager.broadcast(experiment_id, payload))

    async def _log(
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

    async def _log_round_result(
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
                kind = str(event.data.get("kind"))
                if kind == "agent_action":
                    continue
                event_type = kind_to_type.get(kind, event.phase)
                if event_type == "dawn" and isinstance(event.data.get("crisis_event"), dict):
                    event_type = "crisis_event"
                await self._log(
                    experiment_id,
                    event_type=event_type,
                    summary=event.summary,
                    round_number=round_result.round_number,
                    phase=event.phase,
                    data=event.data,
                )
        for action in round_result.action_resolutions:
            await self._log(
                experiment_id,
                event_type="agent_action",
                summary=action.summary,
                round_number=round_result.round_number,
                phase=action.phase,
                agent_id=action.agent_id,
                data=action.model_dump(mode="json"),
            )
            if action.resolved_action_type == "move":
                await self._log(
                    experiment_id,
                    event_type="agent_move",
                    summary=f"{action.agent_name} moves to {action.location}.",
                    round_number=round_result.round_number,
                    phase=action.phase,
                    agent_id=action.agent_id,
                    data={"agent_id": action.agent_id, "location": action.location},
                )
        await self._log(
            experiment_id,
            event_type="resource_update",
            summary="Resources update at the end of the round.",
            round_number=round_result.round_number,
            data=round_result.world_state.resources.model_dump(mode="json"),
        )
        await self._log(
            experiment_id,
            event_type="threat_update",
            summary="Threat settles after the round resolves.",
            round_number=round_result.round_number,
            data={"threat_level": round_result.threat_level},
        )
        round_summary = self._build_round_summary(state, round_result)
        await self._log(
            experiment_id,
            event_type="round_end",
            summary=str(
                round_summary.get("summary", f"Round {round_result.round_number} concluded.")
            ),
            round_number=round_result.round_number,
            data=round_summary,
        )

    def _build_round_summary(
        self, state: SimulationState, round_result: RoundResult
    ) -> dict[str, Any]:
        agents_by_id = {agent.agent_id: agent for agent in state.agents}
        total_actions = len(round_result.action_resolutions)
        cooperative_actions = sum(
            1
            for action in round_result.action_resolutions
            if action.resolved_action_type in COOPERATIVE_ACTION_TYPES
        )
        cooperation_score = round(cooperative_actions / total_actions, 2) if total_actions else 0.0
        betrayal_count = sum(
            1
            for action in round_result.action_resolutions
            if self._is_betrayal_action(action.requested_action_type, action.resolved_action_type)
        )
        betrayal_count += sum(
            1
            for phase in round_result.phases
            for event in phase.events
            if event.data.get("kind") in {"exile_vote", "exile_enacted"}
        )
        sabotage_count = sum(
            1
            for action in round_result.action_resolutions
            if action.requested_action_type in SABOTAGE_ACTION_TYPES
            or action.resolved_action_type in SABOTAGE_ACTION_TYPES
        )
        dominant_faction = max(state.factions, key=lambda faction: faction.influence, default=None)
        return {
            "summary": (
                f"Round {round_result.round_number} closes with cooperation "
                f"{cooperation_score:.2f} and threat {round_result.threat_level:.2f}."
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
            # `sabotage_count` is a focused subset of these broader betrayal signals.
            "betrayal_count": betrayal_count,
            "sabotage_count": sabotage_count,
            "threat_level": round_result.threat_level,
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
            "goal_progress": [
                {
                    "agent_id": action.agent_id,
                    "agent_name": action.agent_name,
                    "goal_text": agents_by_id[action.agent_id].goal.text,
                    "goal_archetype": agents_by_id[action.agent_id].goal.archetype,
                    "status": self._status_value(agents_by_id[action.agent_id].status),
                    "goal_progress": action.goal_progress,
                    "requested_action_type": action.requested_action_type,
                    "resolved_action_type": action.resolved_action_type,
                    "cooperation_intent": action.cooperation_intent,
                    "phase": action.phase,
                    "summary": action.summary,
                }
                for action in round_result.action_resolutions
            ],
        }

    def _round_summary_data(self, logs: list[EventLogItem]) -> dict[int, dict[str, Any]]:
        summaries: dict[int, dict[str, Any]] = {}
        for item in logs:
            if item.type != "round_end" or item.round_number is None:
                continue
            summaries[item.round_number] = item.data
        return summaries

    def _cooperation_data(self, data: dict[str, Any]) -> CooperationMetrics:
        cooperation = data.get("cooperation", {})
        if isinstance(cooperation, dict):
            return {
                "score": self._float_value(cooperation.get("score")),
                "cooperative_actions": int(cooperation.get("cooperative_actions", 0)),
                "total_actions": int(cooperation.get("total_actions", 0)),
            }
        return {"score": 0.0, "cooperative_actions": 0, "total_actions": 0}

    def _goal_progress_index(self, data: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        records: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in data.get("goal_progress", []):
            if not isinstance(item, dict):
                continue
            agent_id = item.get("agent_id")
            if not isinstance(agent_id, str):
                continue
            records[agent_id].append(item)
        return dict(records)

    def _suspicion_data(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        suspicion = data.get("suspicion", [])
        return [item for item in suspicion if isinstance(item, dict)]

    def _faction_data(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        factions = data.get("factions", [])
        return [item for item in factions if isinstance(item, dict)]

    def _crisis_event_data(self, data: dict[str, Any]) -> dict[str, Any]:
        gm = data.get("gm", {})
        if isinstance(gm, dict) and isinstance(gm.get("crisis_event"), dict):
            return cast(dict[str, Any], gm["crisis_event"])
        return {}

    def _resource_data(self, data: dict[str, Any]) -> dict[str, float]:
        resources = data.get("resources", {})
        if not isinstance(resources, dict):
            return {}
        return {
            key: self._float_value(value)
            for key, value in resources.items()
            if isinstance(key, str)
        }

    def _dominant_faction_name(self, data: dict[str, Any]) -> str | None:
        dominant_faction = data.get("dominant_faction")
        return dominant_faction if isinstance(dominant_faction, str) else None

    def _requested_action_type(self, item: EventLogItem) -> str | None:
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

    def _resolved_action_type(self, item: EventLogItem) -> str | None:
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

    def _is_betrayal_action(
        self,
        requested_action_type: str | None,
        resolved_action_type: str | None,
    ) -> bool:
        return (
            requested_action_type in SABOTAGE_ACTION_TYPES
            or resolved_action_type in SABOTAGE_ACTION_TYPES
            or requested_action_type in HOSTILE_ACTION_TYPES
            or resolved_action_type in HOSTILE_ACTION_TYPES
        )

    def _phase_sort_key(self, phase: str | None) -> int:
        order = {"gm_plan": 0, "dawn": 1, "morning": 2, "midday": 3, "afternoon": 4, "night": 5}
        return order.get(phase or "", 99)

    def _status_value(self, status: AgentStatus | str) -> str:
        return status.value if isinstance(status, AgentStatus) else str(status)

    def _goal_outcome(
        self,
        status: str,
        latest_progress: str | None,
        history: list[AgentGoalProgress],
    ) -> GoalOutcome:
        progress_samples = [entry.progress.lower() for entry in history]
        if latest_progress:
            progress_samples.append(latest_progress.lower())
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

    def _string_value(self, value: object, *, default: str | None = None) -> str | None:
        if isinstance(value, str):
            return value
        return default

    def _string_or(self, value: object, default: str = "") -> str:
        if isinstance(value, str):
            return value
        return default

    def _float_value(self, value: object) -> float:
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


runtime = ExperimentRuntime()
