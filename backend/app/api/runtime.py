from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import structlog
from app.agents.mock_brain import MockAgentBrain, NoOpMemoryLLMService
from app.agents.models import AgentMemoryState
from app.agents.service import AgentService
from app.api.models import (
    AgentSpeechAudioMetadata,
    AnalyticsSummary,
    BetrayalTimelineItem,
    CreateExperimentRequest,
    EventLogItem,
    FactionAnalytics,
    GMRoundTimelineItem,
    GoalOutcomeSummary,
    HighlightItem,
    HighlightScope,
    NarrationAudioMetadata,
    RelationshipEdge,
    ReplayIndex,
    RoundAnalyticsItem,
    RoundSnapshotResponse,
    SuspicionAnalytics,
    UsageReport,
)
from app.api.services import (
    AgentSpeechEntry,
    RuntimeAnalyticsService,
    RuntimeAudioService,
    RuntimeEventLogService,
    RuntimeStreamBroadcaster,
)
from app.api.store import ExperimentStore, SqlAlchemyExperimentStore
from app.api.ws_manager import ConnectionManager
from app.core import posthog as ph
from app.db.session import AsyncSessionLocal
from app.engine import EngineAgentState, RoundResult, SimulationEngine, SimulationState
from app.gm import GMService, RuleBasedGMService, get_preset_arc
from app.gm.models import DirectorArc, GMPlanData, GMPlanRecord, GMPlanningContext
from app.highlights import HighlightSelector
from app.llm import UsageRecord
from app.schemas.ws_message import WSMessage, WSMessageType
from app.tts import NarrationTTSService
from app.world import build_default_world_state, resolve_spawn_tile

log = structlog.get_logger(__name__)
logger = logging.getLogger(__name__)

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
        self.event_log = RuntimeEventLogService(store=self.store)
        self.analytics = RuntimeAnalyticsService(
            store=self.store,
            highlight_selector=self.highlight_selector,
            llm_trackers_getter=self._llm_trackers,
        )
        self.audio = RuntimeAudioService(
            store=self.store,
            get_state=self.get_state,
            connection_manager=self.connection_manager,
            tts_service=self.tts_service,
            agent_speech_log=self._agent_speech_log,
            message_builder=self._message,
        )
        self.streaming = RuntimeStreamBroadcaster(
            connection_manager=self.connection_manager,
            get_state=self.get_state,
            message_builder=self._message,
            agent_speech_log=self._agent_speech_log,
            audio_service=self.audio,
        )
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
            await self.event_log.log(
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
        await self.event_log.log(
            experiment_id,
            event_type="experiment_started",
            summary="Experiment started.",
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
        await self.event_log.log(
            experiment_id,
            event_type="experiment_paused",
            summary="Experiment paused.",
        )
        return state

    async def inject_observer_event(self, experiment_id: str, description: str) -> SimulationState:
        state = await self.get_state(experiment_id)
        state.unresolved_plotlines.append(description)
        state.unresolved_plotlines = state.unresolved_plotlines[-10:]
        for agent in state.agents:
            agent.suspicion_level = min(100.0, agent.suspicion_level + 6.0)
        await self.store.save_state(state)
        await self.event_log.log(
            experiment_id,
            event_type="observer_event",
            summary=description,
        )
        self.streaming.schedule_broadcast(
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
        await self.event_log.log(
            experiment_id,
            event_type="arc_updated",
            summary=f"Arc updated to '{arc.name}'.",
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
        await self.event_log.log(
            experiment_id,
            event_type="gm_plan_generated",
            summary=plan.plan.round_theme,
            round_number=next_round,
        )
        if plan.status == "applied":
            await self.audio.prepare_narration_audio(experiment_id, plan)
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
        await self.event_log.log(
            experiment_id,
            event_type="gm_plan_approved",
            summary=applied.plan.round_theme,
            round_number=applied.plan.round,
        )
        await self.audio.prepare_narration_audio(experiment_id, applied)
        return applied

    async def step(self, experiment_id: str) -> tuple[RoundResult, SimulationState]:
        async with self.lock:
            state = await self.get_state(experiment_id)
            round_result = await self._run_round_locked(experiment_id, state)
        await self.streaming.broadcast_round_end(experiment_id, round_result, state)
        return round_result, state

    def start_step(self, experiment_id: str) -> None:
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
        intended_round = 0
        try:
            async with self.lock:
                state = await self.get_state(experiment_id)
                intended_round = state.current_round + 1
                round_result = await self._run_round_locked(experiment_id, state)
            await self.streaming.broadcast_round_end(experiment_id, round_result, state)
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

    async def _run_round_locked(self, experiment_id: str, state: SimulationState) -> RoundResult:
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

        if not state.auto_approve:
            record = await self.get_or_generate_gm_plan(experiment_id)
            approved = self.gm_service.approve_plan(record)
            state.gm_plan = self.gm_service.apply_plan(approved)
            await self.store.save_state(state)
            await self.event_log.log(
                experiment_id,
                event_type="gm_plan_approved",
                summary=state.gm_plan.plan.round_theme,
                round_number=state.gm_plan.plan.round,
            )
            await self.audio.prepare_narration_audio(experiment_id, state.gm_plan)

        hook = self.streaming.build_hook(experiment_id)
        t0 = time.monotonic()
        round_result = await self.engine.run_round(state, hook=hook)
        round_duration = time.monotonic() - t0

        await self.store.save_state(state)
        await self.store.record_round_result(experiment_id, round_result)
        await self.event_log.log_round_result(experiment_id, round_result, state)

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
        return round_result

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
        return await self.analytics.get_usage_report(
            experiment_id,
            round_number=round_number,
            agent_id=agent_id,
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
        return await self.analytics.get_prompt_traces(
            experiment_id,
            limit=limit,
            offset=offset,
            round_number=round_number,
            agent_id=agent_id,
            role=role,
        )

    async def get_analytics_summary(
        self,
        experiment_id: str,
        *,
        state: SimulationState | None = None,
    ) -> AnalyticsSummary:
        resolved_state = state or await self.get_state(experiment_id)
        return await self.analytics.get_analytics_summary(experiment_id, state=resolved_state)

    async def get_round_analytics(self, experiment_id: str) -> list[RoundAnalyticsItem]:
        return await self.analytics.get_round_analytics(experiment_id)

    async def get_goal_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState | None = None,
    ) -> list[GoalOutcomeSummary]:
        resolved_state = state or await self.get_state(experiment_id)
        return await self.analytics.get_goal_analytics(experiment_id, state=resolved_state)

    async def get_betrayal_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState | None = None,
    ) -> list[BetrayalTimelineItem]:
        resolved_state = state or await self.get_state(experiment_id)
        return await self.analytics.get_betrayal_analytics(experiment_id, state=resolved_state)

    async def get_suspicion_analytics(self, experiment_id: str) -> SuspicionAnalytics:
        return await self.analytics.get_suspicion_analytics(experiment_id)

    async def get_faction_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState | None = None,
    ) -> FactionAnalytics:
        resolved_state = state or await self.get_state(experiment_id)
        return await self.analytics.get_faction_analytics(experiment_id, state=resolved_state)

    async def get_gm_timeline(self, experiment_id: str) -> list[GMRoundTimelineItem]:
        return await self.analytics.get_gm_timeline(experiment_id)

    async def get_relationship_analytics(
        self,
        experiment_id: str,
        *,
        state: SimulationState | None = None,
    ) -> list[RelationshipEdge]:
        resolved_state = state or await self.get_state(experiment_id)
        return await self.analytics.get_relationship_analytics(experiment_id, state=resolved_state)

    async def get_highlights(
        self,
        experiment_id: str,
        *,
        scope: HighlightScope = "game",
        round_number: int | None = None,
        logs: list[EventLogItem] | None = None,
    ) -> list[HighlightItem]:
        return await self.analytics.get_highlights(
            experiment_id,
            scope=scope,
            round_number=round_number,
            logs=logs,
        )

    async def get_replay_index(self, experiment_id: str) -> ReplayIndex:
        return await self.analytics.get_replay_index(experiment_id)

    async def get_round_snapshot(
        self, experiment_id: str, round_number: int
    ) -> RoundSnapshotResponse:
        return await self.analytics.get_round_snapshot(experiment_id, round_number)

    async def get_narration_audio_metadata(
        self, experiment_id: str, round_number: int
    ) -> NarrationAudioMetadata:
        return await self.audio.get_narration_audio_metadata(experiment_id, round_number)

    async def get_narration_audio_stream(
        self, experiment_id: str, round_number: int
    ) -> tuple[str, AsyncIterator[bytes]]:
        return await self.audio.get_narration_audio_stream(experiment_id, round_number)

    async def get_agent_speech_metadata(
        self,
        experiment_id: str,
        agent_id: str,
        round_number: int,
        index: int,
    ) -> AgentSpeechAudioMetadata:
        return await self.audio.get_agent_speech_metadata(
            experiment_id,
            agent_id,
            round_number,
            index,
        )

    async def get_agent_speech_audio_stream(
        self,
        experiment_id: str,
        agent_id: str,
        round_number: int,
        index: int,
    ) -> tuple[str, AsyncIterator[bytes]]:
        return await self.audio.get_agent_speech_audio_stream(
            experiment_id,
            agent_id,
            round_number,
            index,
        )

    def _relationship_summary(self, state: SimulationState) -> str:
        parts = []
        for agent in state.agents:
            if agent.relationships:
                parts.append(f"{agent.name} tracks {len(agent.relationships)} relationships.")
        return " ".join(parts) or "Relationships are still taking shape."

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
