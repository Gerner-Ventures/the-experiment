from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, TypedDict, cast, get_args

import structlog
from app.agents.mock_brain import MockAgentBrain, NoOpMemoryLLMService
from app.agents.models import AgentMemoryState
from app.agents.service import AgentService
from app.api.models import (
    AgentSpeechAudioMetadata,
    AnalyticsSummary,
    AgentGoalProgress,
    AgentSuspicionHistory,
    BetrayalTimelineItem,
    CreateExperimentRequest,
    EventLogItem,
    EventLogType,
    FactionAnalytics,
    FactionMembershipChange,
    FactionTimelinePoint,
    GMRoundTimelineItem,
    GoalOutcomeSummary,
    HighlightItem,
    NarrationAudioMetadata,
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
from app.api.store import ExperimentStore, SqlAlchemyExperimentStore
from app.api.ws_manager import ConnectionManager
from app.highlights import HighlightSelector
from app.db.models import AgentStatus
from app.db.session import AsyncSessionLocal
from app.agents.models import AgentTurnResult
from app.engine import EngineAgentState, RoundResult, SimulationEngine, SimulationState
from app.engine.models import FactionKind, PhaseName, PhaseResult
from app.gm import GMService, RuleBasedGMService, get_preset_arc
from app.gm.models import DirectorArc, GMPlanData, GMPlanRecord, GMPlanningContext
from app.llm import UsageRecord, UsageSummary
from app.schemas.ws_message import WSMessage, WSMessageType
from app.core import posthog as ph
from app.tts import NarrationAudioError, NarrationAudioRequest, NarrationTTSService
from app.world import build_default_world_state, resolve_spawn_tile

log = structlog.get_logger(__name__)

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

# Maps RoundEvent.data["kind"] to WSMessageType for per-event WS broadcasts.
# Used by the shared RoundHook-based websocket path.
_EVENT_KIND_TO_WS_TYPE: dict[str, WSMessageType] = {
    "agent_speak": "agent_speak",
    "meeting_start": "meeting_start",
    "meeting_speech": "meeting_speech",
    "meeting_vote": "meeting_vote",
    "meeting_result": "meeting_result",
    "faction_update": "faction_update",
    "cult_activity": "cult_activity",
    "exile_vote": "exile_vote",
    "exile_enacted": "exile_result",
}


class AgentSpeechEntry(TypedDict):
    agent_id: str
    character_id: str
    round_number: int
    index: int
    text: str


def _phase_event_ws_type(event: Any) -> WSMessageType | None:
    data = getattr(event, "data", {})
    if not isinstance(data, dict):
        return None
    kind = str(data.get("kind", ""))
    # Regular agent_action events already stream through RoundHook.on_agent_action.
    # Only engine-generated consequence actions need a second broadcast from phase completion.
    if kind == "agent_action" and bool(data.get("is_consequence")):
        return "agent_action"
    return _EVENT_KIND_TO_WS_TYPE.get(kind) if kind else None


class CooperationMetrics(TypedDict):
    score: float
    cooperative_actions: int
    total_actions: int


GoalOutcome = Literal["achieved", "partial", "failed", "unknown"]
RuntimeLLMMode = Literal["live", "mock"]


@dataclass(frozen=True)
class RuntimeLLMModeServices:
    gm_service: GMService
    agent_service: AgentService


class ExperimentRuntime:
    def __init__(
        self,
        *,
        store: ExperimentStore | None = None,
        engine: SimulationEngine | None = None,
        gm_service: GMService | None = None,
        connection_manager: ConnectionManager | None = None,
        tts_service: NarrationTTSService | None = None,
        mock_seed: int = 0,
        llm_mode: RuntimeLLMMode | None = None,
    ) -> None:
        self.gm_service = gm_service or (engine.gm_service if engine is not None else GMService())
        self.engine = engine or SimulationEngine(gm_service=self.gm_service)
        if getattr(self.engine, "agent_service", None) is None:
            self.engine.agent_service = AgentService()
        self.engine.gm_service = self.gm_service
        self.connection_manager = connection_manager or ConnectionManager()
        self.store = store or SqlAlchemyExperimentStore(AsyncSessionLocal)
        self.tts_service = tts_service
        self.highlight_selector = HighlightSelector()
        self.lock = asyncio.Lock()
        self._steps_in_progress: dict[str, bool] = {}
        self._current_tasks: dict[str, asyncio.Task[None]] = {}
        self._agent_speech_log: dict[str, list[AgentSpeechEntry]] = defaultdict(list)
        self._llm_mode_services = self._build_llm_mode_services(mock_seed=mock_seed)
        inferred_mode = self._infer_llm_mode()
        if llm_mode is None and inferred_mode == "mock":
            self._llm_mode_services["mock"] = RuntimeLLMModeServices(
                gm_service=self.gm_service,
                agent_service=self.engine.agent_service,
            )
        self._llm_mode: RuntimeLLMMode = "live"
        self._apply_llm_mode(llm_mode or inferred_mode)

    async def aclose(self) -> None:
        self._agent_speech_log.clear()
        if self.tts_service is not None:
            await self.tts_service.aclose()

    def get_llm_mode_status(self) -> dict[str, bool | str]:
        return {
            "mode": self._llm_mode,
            "llm_calls_enabled": self._llm_mode == "live",
        }

    async def set_llm_mode(self, mode: RuntimeLLMMode) -> dict[str, bool | str]:
        async with self.lock:
            self._apply_llm_mode(mode)
            log.info("runtime_llm_mode_changed", mode=mode)
            ph.capture(
                "runtime_llm_mode_changed",
                {
                    "mode": mode,
                    "llm_calls_enabled": mode == "live",
                },
            )
            return self.get_llm_mode_status()

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
                data={
                    "resources": state.world_state.resources.model_dump(mode="json"),
                    "world_state": state.world_state.model_dump(mode="json"),
                },
            )
            log.info(
                "experiment_created",
                experiment_id=experiment_id,
                name=request.name,
                agent_count=len(agents),
                total_rounds=request.total_rounds,
            )
            ph.capture(
                "experiment_created",
                {
                    "experiment_id": experiment_id,
                    "name": request.name,
                    "agent_count": len(agents),
                    "total_rounds": request.total_rounds,
                    "preset_arc_id": request.preset_arc_id,
                },
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
        log.info("experiment_started", experiment_id=experiment_id)
        ph.capture(
            "experiment_started",
            {
                "experiment_id": experiment_id,
                "agent_count": len(state.agents),
                "total_rounds": state.total_rounds,
            },
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
        if plan.status == "applied":
            await self._prepare_narration_audio(experiment_id, plan)
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
        await self._prepare_narration_audio(experiment_id, applied)
        return applied

    async def step(self, experiment_id: str) -> tuple[RoundResult, SimulationState]:
        """Run a full round synchronously while broadcasting via the shared hook path."""
        async with self.lock:
            state = await self.get_state(experiment_id)
            was_setup = state.status == "setup"
            if was_setup:
                state.status = "running"
                log.info("experiment_started", experiment_id=experiment_id)
                ph.capture(
                    "experiment_started",
                    {
                        "experiment_id": experiment_id,
                        "agent_count": len(state.agents),
                        "total_rounds": state.total_rounds,
                    },
                )
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
                await self._prepare_narration_audio(experiment_id, state.gm_plan)
            t0 = time.monotonic()
            hook = _StreamingHook(
                experiment_id=experiment_id,
                runtime=self,
            )
            round_result = await self.engine.run_round(state, hook=hook)
            round_duration = time.monotonic() - t0
            await self.store.save_state(state)
            await self.store.record_round_result(experiment_id, round_result)
            await self._log_round_result(experiment_id, round_result, state)

            log.info(
                "round_completed",
                experiment_id=experiment_id,
                round_number=round_result.round_number,
                total_rounds=state.total_rounds,
                threat_level=round_result.threat_level,
                duration_seconds=round(round_duration, 2),
            )
            ph.capture(
                "round_completed",
                {
                    "experiment_id": experiment_id,
                    "round_number": round_result.round_number,
                    "total_rounds": state.total_rounds,
                    "threat_level": round_result.threat_level,
                    "duration_seconds": round(round_duration, 2),
                },
            )

            is_final = state.status in ("completed", "collapsed")
            if is_final:
                log.info(
                    "experiment_finished",
                    experiment_id=experiment_id,
                    status=state.status,
                    total_rounds=state.total_rounds,
                )
                ph.capture(
                    "experiment_finished",
                    {
                        "experiment_id": experiment_id,
                        "status": state.status,
                        "total_rounds": state.total_rounds,
                    },
                )

        await self._broadcast_round_end(experiment_id, round_result, state)
        return round_result, state

    def start_step(self, experiment_id: str) -> None:
        """Start a round as a background task. Results stream via WS."""
        if self._steps_in_progress.get(experiment_id):
            raise RuntimeError("A round is already in progress")
        self._steps_in_progress[experiment_id] = True
        task = asyncio.create_task(self._step_streaming(experiment_id))
        self._current_tasks[experiment_id] = task

        def _on_step_done(_: asyncio.Task[None]) -> None:
            self._steps_in_progress.pop(experiment_id, None)
            self._current_tasks.pop(experiment_id, None)

        task.add_done_callback(_on_step_done)

    async def _step_streaming(self, experiment_id: str) -> None:
        """Run a round using SimulationEngine.run_round() with a streaming hook."""
        intended_round = 0
        try:
            async with self.lock:
                state = await self.get_state(experiment_id)
                intended_round = state.current_round + 1
                if state.status == "setup":
                    state.status = "running"
                    log.info("experiment_started", experiment_id=experiment_id)
                    ph.capture(
                        "experiment_started",
                        {
                            "experiment_id": experiment_id,
                            "agent_count": len(state.agents),
                            "total_rounds": state.total_rounds,
                        },
                    )

                # Pre-approve GM plan if needed (before engine runs)
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
                    await self._prepare_narration_audio(experiment_id, state.gm_plan)

                # Run round through the single engine code path with streaming hook
                hook = _StreamingHook(
                    experiment_id=experiment_id,
                    runtime=self,
                )
                t0 = time.monotonic()
                round_result = await self.engine.run_round(state, hook=hook)
                round_duration = time.monotonic() - t0

                await self.store.save_state(state)
                await self.store.record_round_result(experiment_id, round_result)
                await self._log_round_result(experiment_id, round_result, state)

                log.info(
                    "round_completed",
                    experiment_id=experiment_id,
                    round_number=round_result.round_number,
                    total_rounds=state.total_rounds,
                    threat_level=round_result.threat_level,
                    duration_seconds=round(round_duration, 2),
                )
                ph.capture(
                    "round_completed",
                    {
                        "experiment_id": experiment_id,
                        "round_number": round_result.round_number,
                        "total_rounds": state.total_rounds,
                        "threat_level": round_result.threat_level,
                        "duration_seconds": round(round_duration, 2),
                    },
                )

                if state.status in ("completed", "collapsed"):
                    log.info(
                        "experiment_finished",
                        experiment_id=experiment_id,
                        status=state.status,
                        total_rounds=state.total_rounds,
                    )
                    ph.capture(
                        "experiment_finished",
                        {
                            "experiment_id": experiment_id,
                            "status": state.status,
                            "total_rounds": state.total_rounds,
                        },
                    )
            await self._broadcast_round_end(experiment_id, round_result, state)
        except Exception:
            logger.exception("Background step failed for %s", experiment_id)
            try:
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message(
                        "step_error",
                        round_number=intended_round,
                        data={"error": "Round execution failed. Check server logs."},
                    ),
                )
            except Exception:
                logger.exception("Failed to broadcast step_error for %s", experiment_id)

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
                    outcome=self._goal_outcome(self._status_value(agent.status), history),
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
                        kind=self._faction_kind(entry.get("kind")),
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

    async def get_narration_audio_metadata(
        self, experiment_id: str, round_number: int
    ) -> NarrationAudioMetadata:
        state = await self.get_state(experiment_id)
        request = await self._narration_audio_request(experiment_id, round_number, state=state)
        status = "unavailable"
        cache_hit = False
        audio_url: str | None = None
        if self.tts_service is not None:
            status, cache_hit = await self.tts_service.get_status(request)
            if status != "unavailable":
                audio_url = self.tts_service.build_audio_url(experiment_id, round_number)
        return NarrationAudioMetadata(
            experiment_id=experiment_id,
            round_number=round_number,
            text=request.text,
            voice_id=request.voice_id,
            model_id=request.model_id,
            output_format=request.output_format,
            status=cast(Literal["pending", "ready", "unavailable"], status),
            audio_url=audio_url,
            cache_hit=cache_hit,
        )

    async def get_narration_audio_stream(
        self, experiment_id: str, round_number: int
    ) -> tuple[str, AsyncIterator[bytes]]:
        request = await self._narration_audio_request(experiment_id, round_number)
        if self.tts_service is None:
            raise NarrationAudioError("Narration audio is not configured.", status_code=503)
        result = await self.tts_service.stream(request)
        log.info(
            "narration_audio_stream_requested",
            experiment_id=experiment_id,
            round_number=round_number,
            narration_hash=result.cache_key,
            voice_id=request.voice_id,
            model_id=request.model_id,
            output_format=request.output_format,
            cache_hit=result.cache_hit,
        )
        return result.content_type, result.stream

    async def _find_agent_speech_entry(
        self,
        experiment_id: str,
        agent_id: str,
        round_number: int,
        index: int,
    ) -> AgentSpeechEntry | None:
        # Fast path: check in-memory log first
        for entry in self._agent_speech_log.get(experiment_id, []):
            if (
                entry["agent_id"] == agent_id
                and entry["round_number"] == round_number
                and entry["index"] == index
            ):
                return entry

        # Slow path: reconstruct from persisted event log (survives process restart)
        logs = await self.store.list_logs(experiment_id)
        # Build a character_id lookup from current state
        character_map: dict[str, str] = {}
        try:
            state = await self.get_state(experiment_id)
            for agent in state.agents:
                character_map[agent.agent_id] = agent.character_id or ""
        except KeyError:
            pass

        # Walk persisted logs to find agent_speak events for the target round,
        # computing per-agent indexes as we go.
        agent_round_counts: dict[str, int] = {}
        for item in logs:
            if item.round_number != round_number:
                continue
            if item.data.get("kind") != "agent_speak":
                continue
            ev_agent_id = str(item.data.get("agent_id", ""))
            message_text = str(item.data.get("message", ""))
            if not ev_agent_id or not message_text.strip():
                continue
            count_key = ev_agent_id
            current_index = agent_round_counts.get(count_key, 0)
            if ev_agent_id == agent_id and current_index == index:
                reconstructed: AgentSpeechEntry = {
                    "agent_id": ev_agent_id,
                    "character_id": character_map.get(ev_agent_id, ""),
                    "round_number": round_number,
                    "index": current_index,
                    "text": message_text,
                }
                # Backfill in-memory cache so subsequent lookups are fast
                self._agent_speech_log[experiment_id].append(reconstructed)
                return reconstructed
            agent_round_counts[count_key] = current_index + 1

        return None

    async def get_agent_speech_metadata(
        self,
        experiment_id: str,
        agent_id: str,
        round_number: int,
        index: int,
    ) -> AgentSpeechAudioMetadata:
        await self.get_state(experiment_id)  # raises KeyError if not found
        entry = await self._find_agent_speech_entry(experiment_id, agent_id, round_number, index)
        if entry is None:
            raise KeyError(
                f"No speech entry for agent {agent_id} round {round_number} index {index}"
            )
        if self.tts_service is None:
            return AgentSpeechAudioMetadata(
                experiment_id=experiment_id,
                agent_id=agent_id,
                round_number=round_number,
                index=index,
                text=entry["text"],
                voice_id="",
                model_id="",
                output_format="",
                status="unavailable",
            )
        request = self.tts_service.build_speech_request(
            experiment_id=experiment_id,
            round_number=round_number,
            text=entry["text"],
            character_id=entry["character_id"],
        )
        status, cache_hit = await self.tts_service.get_status(request)
        audio_url: str | None = None
        if status == "ready":
            audio_url = self.tts_service.build_speech_audio_url(
                experiment_id, agent_id, round_number, index
            )
        return AgentSpeechAudioMetadata(
            experiment_id=experiment_id,
            agent_id=agent_id,
            round_number=round_number,
            index=index,
            text=entry["text"],
            voice_id=request.voice_id,
            model_id=request.model_id,
            output_format=request.output_format,
            status=cast(Literal["pending", "ready", "unavailable"], status),
            audio_url=audio_url,
            cache_hit=cache_hit,
        )

    async def get_agent_speech_audio_stream(
        self,
        experiment_id: str,
        agent_id: str,
        round_number: int,
        index: int,
    ) -> tuple[str, AsyncIterator[bytes]]:
        entry = await self._find_agent_speech_entry(experiment_id, agent_id, round_number, index)
        if entry is None:
            raise KeyError(
                f"No speech entry for agent {agent_id} round {round_number} index {index}"
            )
        if self.tts_service is None:
            raise NarrationAudioError("Narration audio is not configured.", status_code=503)
        request = self.tts_service.build_speech_request(
            experiment_id=experiment_id,
            round_number=round_number,
            text=entry["text"],
            character_id=entry["character_id"],
        )
        result = await self.tts_service.stream(request)
        log.info(
            "agent_speech_audio_stream_requested",
            experiment_id=experiment_id,
            agent_id=agent_id,
            round_number=round_number,
            index=index,
            cache_hit=result.cache_hit,
        )
        return result.content_type, result.stream

    async def _prepare_agent_speech_audio(
        self,
        experiment_id: str,
        round_number: int,
        phase_result: PhaseResult,
        entries_to_prewarm: list[AgentSpeechEntry],
    ) -> None:
        """Pregenerate TTS audio for the given speech entries."""
        if self.tts_service is None or not self.tts_service.configured:
            for entry in entries_to_prewarm:
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message(
                        "agent_speech_audio",
                        round_number=round_number,
                        phase=phase_result.phase,
                        data={
                            "agent_id": entry["agent_id"],
                            "round": round_number,
                            "index": entry["index"],
                            "status": "unavailable",
                            "audio_url": None,
                        },
                    ),
                )
            return

        tts_service = self.tts_service

        if not entries_to_prewarm:
            return

        # Broadcast pending status for all entries
        for entry in entries_to_prewarm:
            await self.connection_manager.broadcast(
                experiment_id,
                self._message(
                    "agent_speech_audio",
                    round_number=round_number,
                    phase=phase_result.phase,
                    data={
                        "agent_id": entry["agent_id"],
                        "round": round_number,
                        "index": entry["index"],
                        "status": "pending",
                        "audio_url": None,
                    },
                ),
            )

        async def _prewarm_one(entry: AgentSpeechEntry) -> None:
            request = tts_service.build_speech_request(
                experiment_id=experiment_id,
                round_number=round_number,
                text=entry["text"],
                character_id=entry["character_id"],
            )
            try:
                await tts_service.prewarm(request)
                audio_url = tts_service.build_speech_audio_url(
                    experiment_id, entry["agent_id"], round_number, entry["index"]
                )
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message(
                        "agent_speech_audio",
                        round_number=round_number,
                        phase=phase_result.phase,
                        data={
                            "agent_id": entry["agent_id"],
                            "round": round_number,
                            "index": entry["index"],
                            "status": "ready",
                            "audio_url": audio_url,
                        },
                    ),
                )
            except NarrationAudioError as exc:
                log.warning(
                    "agent_speech_audio_prewarm_failed",
                    experiment_id=experiment_id,
                    agent_id=entry["agent_id"],
                    round_number=round_number,
                    index=entry["index"],
                    error=str(exc),
                )
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message(
                        "agent_speech_audio",
                        round_number=round_number,
                        phase=phase_result.phase,
                        data={
                            "agent_id": entry["agent_id"],
                            "round": round_number,
                            "index": entry["index"],
                            "status": "error",
                            "audio_url": None,
                        },
                    ),
                )

        async def _prewarm_all() -> None:
            await asyncio.gather(
                *[_prewarm_one(e) for e in entries_to_prewarm],
                return_exceptions=True,
            )

        asyncio.create_task(_prewarm_all())

    async def _broadcast_round_end(
        self,
        experiment_id: str,
        round_result: RoundResult,
        state: SimulationState,
    ) -> None:
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "resource_update",
                round_number=round_result.round_number,
                data=state.world_state.resources.model_dump(mode="json"),
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "threat_update",
                round_number=round_result.round_number,
                data={"threat_level": state.world_state.threat_level},
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "round_end",
                round_number=round_result.round_number,
                data={
                    "status": state.status,
                    "current_round": state.current_round,
                    "total_rounds": state.total_rounds,
                    "threat_level": state.world_state.threat_level,
                    "resources": state.world_state.resources.model_dump(mode="json"),
                    "agents": [
                        {
                            "agent_id": agent.agent_id,
                            "name": agent.name,
                            "character_id": agent.character_id,
                            "status": self._status_value(agent.status),
                            "location": agent.location,
                            "suspicion_level": agent.suspicion_level,
                            "faction_id": agent.faction_id,
                            "faction_role": agent.faction_role,
                            "influence": agent.influence,
                        }
                        for agent in state.agents
                    ],
                },
            ),
        )
        if state.status in ("completed", "collapsed"):
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
            if not self._is_consequence_action(item)
            and self._resolved_action_type(item) in COOPERATIVE_ACTION_TYPES
        )
        decisional_actions = sum(
            1 for item in agent_actions if not self._is_consequence_action(item)
        )
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
        for services in self._llm_mode_services.values():
            candidates.extend(
                [
                    getattr(getattr(services.gm_service, "llm_service", None), "client", None),
                    getattr(
                        getattr(
                            getattr(services.agent_service, "brain", None), "llm_service", None
                        ),
                        "client",
                        None,
                    ),
                ]
            )
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

    def _build_llm_mode_services(
        self, *, mock_seed: int
    ) -> dict[RuntimeLLMMode, RuntimeLLMModeServices]:
        return {
            "live": RuntimeLLMModeServices(
                gm_service=self.gm_service,
                agent_service=self.engine.agent_service,
            ),
            "mock": RuntimeLLMModeServices(
                gm_service=RuleBasedGMService(),
                agent_service=AgentService(
                    brain=MockAgentBrain(seed=mock_seed),
                    memory_llm_service=NoOpMemoryLLMService(),
                ),
            ),
        }

    def _infer_llm_mode(self) -> RuntimeLLMMode:
        brain = getattr(self.engine.agent_service, "brain", None)
        if isinstance(self.gm_service, RuleBasedGMService) or isinstance(brain, MockAgentBrain):
            return "mock"
        return "live"

    def _capture_live_services(self) -> None:
        self._llm_mode_services["live"] = RuntimeLLMModeServices(
            gm_service=self.gm_service,
            agent_service=self.engine.agent_service,
        )

    def _apply_llm_mode(self, mode: RuntimeLLMMode) -> None:
        if mode == "mock" and self._llm_mode != "mock":
            self._capture_live_services()
        services = self._llm_mode_services[mode]
        self._llm_mode = mode
        self.gm_service = services.gm_service
        self.engine.gm_service = services.gm_service
        self.engine.agent_service = services.agent_service

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

    def _message(
        self,
        message_type: WSMessageType,
        *,
        round_number: int,
        data: dict[str, Any],
        phase: str | None = None,
        is_consequence: bool = False,
    ) -> dict[str, Any]:
        return WSMessage(
            type=message_type,
            round=round_number,
            phase=phase,
            timestamp=datetime.now(UTC),
            is_consequence=is_consequence,
            data=data,
        ).model_dump(mode="json")

    def _schedule_broadcast(self, experiment_id: str, payload: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self.connection_manager.broadcast(experiment_id, payload))

    async def _prepare_narration_audio(
        self,
        experiment_id: str,
        gm_plan: GMPlanRecord | None,
    ) -> None:
        if gm_plan is None or gm_plan.status != "applied" or not gm_plan.plan.narration.strip():
            return
        request = await self._narration_audio_request(
            experiment_id,
            gm_plan.plan.round,
            narration_text=gm_plan.plan.narration,
        )
        await self._broadcast_narration_audio_status(experiment_id, request)
        if self.tts_service is None or not self.tts_service.configured:
            return
        tts_service = self.tts_service

        async def _prewarm() -> None:
            try:
                await tts_service.prewarm(request)
                await self._broadcast_narration_audio_status(experiment_id, request)
            except NarrationAudioError as exc:
                log.warning(
                    "narration_audio_prewarm_failed",
                    experiment_id=experiment_id,
                    round_number=request.round_number,
                    narration_hash=tts_service.cache_key(request),
                    error=str(exc),
                )
                await self._broadcast_narration_audio_status(
                    experiment_id,
                    request,
                    error=str(exc),
                )

        asyncio.create_task(_prewarm())

    async def _broadcast_narration_audio_status_for_plan(
        self, experiment_id: str, gm_plan: GMPlanRecord
    ) -> None:
        if self.tts_service is None or not self.tts_service.configured:
            return
        if gm_plan.status != "applied" or not gm_plan.plan.narration.strip():
            return
        request = await self._narration_audio_request(
            experiment_id,
            gm_plan.plan.round,
            narration_text=gm_plan.plan.narration,
        )
        await self._broadcast_narration_audio_status(experiment_id, request)

    async def _broadcast_narration_audio_status(
        self,
        experiment_id: str,
        request: NarrationAudioRequest,
        *,
        error: str | None = None,
    ) -> None:
        if self.tts_service is None:
            return
        if error is not None:
            await self.connection_manager.broadcast(
                experiment_id,
                self._message(
                    "gm_audio_status",
                    round_number=request.round_number,
                    phase="gm_plan",
                    data={"status": "error", "error": error},
                ),
            )
            return
        status, _ = await self.tts_service.get_status(request)
        if status == "unavailable":
            await self.connection_manager.broadcast(
                experiment_id,
                self._message(
                    "gm_audio_status",
                    round_number=request.round_number,
                    phase="gm_plan",
                    data={"status": "error", "error": "Narration audio is unavailable."},
                ),
            )
            return
        data: dict[str, Any] = {"status": status}
        if status == "ready":
            data["audio_url"] = self.tts_service.build_audio_url(
                experiment_id,
                request.round_number,
            )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "gm_audio_status",
                round_number=request.round_number,
                phase="gm_plan",
                data=data,
            ),
        )

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

    async def _narration_audio_request(
        self,
        experiment_id: str,
        round_number: int,
        *,
        state: SimulationState | None = None,
        narration_text: str | None = None,
    ) -> NarrationAudioRequest:
        if self.tts_service is None:
            raise NarrationAudioError("Narration audio is not configured.", status_code=503)
        resolved_state = state or await self.get_state(experiment_id)
        text = narration_text or await self._resolve_narration_text(
            experiment_id,
            round_number,
            state=resolved_state,
        )
        return self.tts_service.build_request(
            experiment_id=experiment_id,
            round_number=round_number,
            text=text,
            map_name=resolved_state.world_state.map_name,
        )

    async def _resolve_narration_text(
        self,
        experiment_id: str,
        round_number: int,
        *,
        state: SimulationState | None = None,
    ) -> str:
        resolved_state = state or await self.get_state(experiment_id)
        if round_number < 1 or round_number > resolved_state.total_rounds:
            raise KeyError(round_number)
        current_plan = resolved_state.gm_plan
        if (
            current_plan is not None
            and current_plan.status == "applied"
            and current_plan.plan.round == round_number
            and current_plan.plan.narration.strip()
        ):
            return current_plan.plan.narration

        round_summaries = self._round_summary_data(await self.store.list_logs(experiment_id))
        round_summary = round_summaries.get(round_number)
        narration = None
        if round_summary is not None:
            narration = self._string_value(round_summary.get("gm", {}).get("narration"))
        if narration:
            return narration
        raise NarrationAudioError(
            "Narration is not available for this round yet.",
            status_code=409,
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
                kind = str(event.data.get("kind", ""))
                if kind == "agent_action":
                    continue
                event_type = kind_to_type.get(kind, event.phase) if kind else event.phase
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
                # Keep movement in the durable event log for analytics/history even
                # though realtime movement is now conveyed via agent_action payloads.
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
            data={"threat_level": state.world_state.threat_level},
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
                    "status": self._status_value(agent.status) if agent is not None else "",
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

    def _is_consequence_action(self, item: EventLogItem) -> bool:
        return bool(item.data.get("is_consequence"))

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

    def _string_value(self, value: object, *, default: str | None = None) -> str | None:
        if isinstance(value, str):
            return value
        return default

    def _faction_kind(self, value: object) -> FactionKind | None:
        if value in get_args(FactionKind):
            return cast(FactionKind, value)
        return None

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


class _StreamingHook:
    """RoundHook implementation that broadcasts WS messages via ConnectionManager."""

    def __init__(self, *, experiment_id: str, runtime: ExperimentRuntime) -> None:
        self._experiment_id = experiment_id
        self._runtime = runtime

    async def on_round_start(self, round_number: int, gm_plan: GMPlanRecord) -> None:
        cm = self._runtime.connection_manager
        msg = self._runtime._message
        eid = self._experiment_id

        await cm.broadcast(
            eid,
            msg(
                "round_start",
                round_number=round_number,
                data={"theme": gm_plan.plan.round_theme},
            ),
        )
        await cm.broadcast(
            eid,
            msg(
                "gm_plan",
                round_number=round_number,
                data=gm_plan.model_dump(mode="json"),
            ),
        )
        await cm.broadcast(
            eid,
            msg(
                "crisis_event",
                round_number=round_number,
                phase="dawn",
                data=gm_plan.plan.crisis_event.model_dump(mode="json"),
            ),
        )
        await self._runtime._broadcast_narration_audio_status_for_plan(eid, gm_plan)

    async def on_phase_start(self, round_number: int, phase: PhaseName) -> None:
        # We intentionally send a lightweight "starting" phase_change before the
        # later event-bearing phase_change so clients can update in-progress UI.
        await self._runtime.connection_manager.broadcast(
            self._experiment_id,
            self._runtime._message(
                "phase_change",
                round_number=round_number,
                phase=phase,
                data={"status": "starting"},
            ),
        )

    async def on_phase_complete(self, round_number: int, phase_result: PhaseResult) -> None:
        cm = self._runtime.connection_manager
        msg = self._runtime._message
        eid = self._experiment_id

        await cm.broadcast(
            eid,
            msg(
                "phase_change",
                round_number=round_number,
                phase=phase_result.phase,
                data={"events": [e.model_dump(mode="json") for e in phase_result.events]},
            ),
        )
        # Dual broadcast: phase_change above carries the full event list for the
        # experiment store.  The individual typed messages below (agent_speak,
        # meeting_start, etc.) are consumed by dedicated UI components that
        # subscribe to specific WS message types.  Both are intentional.
        new_speech_entries: list[AgentSpeechEntry] = []
        for event in phase_result.events:
            msg_type = _phase_event_ws_type(event)
            if msg_type:
                await cm.broadcast(
                    eid,
                    msg(
                        msg_type,
                        round_number=round_number,
                        phase=phase_result.phase,
                        data=event.data,
                        is_consequence=bool(event.data.get("is_consequence")),
                    ),
                )
            # Record agent speech entries for TTS pregeneration
            event_kind = str(event.data.get("kind", ""))
            if event_kind == "agent_speak":
                agent_id = str(event.data.get("agent_id", ""))
                message_text = str(event.data.get("message", ""))
                if agent_id and message_text.strip():
                    # Determine index: count existing entries for this agent+round
                    existing = [
                        e
                        for e in self._runtime._agent_speech_log.get(eid, [])
                        if e["agent_id"] == agent_id and e["round_number"] == round_number
                    ]
                    index = len(existing)
                    # Look up character_id from state agents
                    character_id = ""
                    try:
                        state = await self._runtime.get_state(eid)
                        for agent in state.agents:
                            if agent.agent_id == agent_id:
                                character_id = agent.character_id or ""
                                break
                    except KeyError:
                        pass
                    entry: AgentSpeechEntry = {
                        "agent_id": agent_id,
                        "character_id": character_id,
                        "round_number": round_number,
                        "index": index,
                        "text": message_text,
                    }
                    self._runtime._agent_speech_log[eid].append(entry)
                    new_speech_entries.append(entry)

        # Kick off TTS pregeneration only for the entries created in this phase
        if new_speech_entries:
            await self._runtime._prepare_agent_speech_audio(
                eid, round_number, phase_result, new_speech_entries
            )

    async def on_agent_action(
        self,
        round_number: int,
        phase: PhaseName,
        agent: EngineAgentState,
        turn: AgentTurnResult,
    ) -> None:
        await self._runtime.connection_manager.broadcast(
            self._experiment_id,
            self._runtime._message(
                "agent_action",
                round_number=round_number,
                phase=phase,
                data={
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "action": turn.decision.action.model_dump(mode="json"),
                    "is_consequence": False,
                    "inner_thought": turn.decision.inner_thought,
                    "cooperation_intent": turn.decision.cooperation_intent,
                    "goal_progress": turn.decision.goal_progress,
                },
            ),
        )
