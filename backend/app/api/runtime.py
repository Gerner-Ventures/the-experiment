from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder

from app.agents.models import AgentMemoryState
from app.api.models import (
    AnalyticsSummary,
    CreateExperimentRequest,
    EventLogItem,
    EventLogType,
    HighlightItem,
    RelationshipEdge,
    ReplayIndex,
    ReplayRound,
    RoundSnapshotResponse,
    UsageGroup,
    UsageReport,
)
from app.api.store import ExperimentStore, SqlAlchemyExperimentStore
from app.db.session import AsyncSessionLocal
from app.engine import EngineAgentState, RoundResult, SimulationEngine, SimulationState
from app.engine.models import PhaseResult, RoundEvent
from app.gm import GMService, get_preset_arc
from app.gm.models import DirectorArc, GMPlanData, GMPlanRecord, GMPlanningContext
from app.llm import UsageRecord, UsageSummary
from app.schemas.ws_message import WSMessage, WSMessageType
from app.world import build_default_world_state


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: defaultdict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, experiment_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[experiment_id].add(websocket)

    def disconnect(self, experiment_id: str, websocket: WebSocket) -> None:
        self.connections[experiment_id].discard(websocket)

    async def broadcast(self, experiment_id: str, payload: dict[str, Any]) -> None:
        sockets = list(self.connections[experiment_id])
        if not sockets:
            return
        for socket in sockets:
            await socket.send_json(jsonable_encoder(payload))


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
            state = SimulationState(
                experiment_id=experiment_id,
                experiment_name=request.name,
                total_rounds=request.total_rounds,
                current_round=0,
                status="setup",
                auto_approve=request.auto_approve,
                arc=arc,
                world_state=build_default_world_state(),
                agents=[
                    EngineAgentState(
                        agent_id=str(uuid.uuid4()),
                        name=agent.name,
                        character_id=agent.character_id,
                        personality=agent.personality,
                        goal=agent.goal,
                        memory=AgentMemoryState(),
                        location=agent.location,
                        inventory=agent.inventory,
                        relationships={},
                        suspicion_level=0,
                        llm_model=agent.llm_model,
                    )
                    for agent in request.agents
                ],
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
        """Run a full round synchronously (legacy). Prefer step_async for streaming."""
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
            await self._log_round_result(experiment_id, round_result)
        await self.broadcast_round(experiment_id, round_result)
        return round_result, state

    def start_step(self, experiment_id: str) -> int:
        """Start a round as a background task, returning the upcoming round number."""
        # Peek at current state to get the round number
        # The actual work runs in the background
        asyncio.create_task(self._step_streaming(experiment_id))
        return 0  # Will be replaced by the broadcast

    async def _step_streaming(self, experiment_id: str) -> None:
        """Run a round phase-by-phase, broadcasting WS events after each phase."""
        try:
            async with self.lock:
                state = await self.get_state(experiment_id)
                if state.status == "setup":
                    state.status = "running"

                engine = self.engine
                round_number = state.current_round + 1
                state.world_state.round_number = round_number
                engine._refresh_factions(state)

                # Broadcast immediately so frontend knows a round is in progress
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message(
                        "phase_change",
                        round_number=round_number,
                        phase="gm_plan",
                        data={"status": "generating"},
                    ),
                )

                # --- GM Plan phase ---
                if not state.auto_approve:
                    record = await self.get_or_generate_gm_plan(experiment_id)
                    approved = self.gm_service.approve_plan(record)
                    state.gm_plan = self.gm_service.apply_plan(approved)

                if (
                    state.gm_plan
                    and state.gm_plan.plan.round == round_number
                    and state.gm_plan.status == "applied"
                ):
                    gm_plan = state.gm_plan
                    gm_result = PhaseResult(
                        phase="gm_plan",
                        events=[RoundEvent(
                            phase="gm_plan",
                            summary=f"Using approved GM plan '{gm_plan.plan.round_theme}'.",
                            data={"status": gm_plan.status, "theme": gm_plan.plan.round_theme},
                        )],
                    )
                else:
                    gm_result, gm_plan = await engine._gm_plan_phase(state, round_number)

                # Broadcast round start + gm plan
                await self._broadcast_phase_start(experiment_id, round_number, gm_plan)
                await self._broadcast_phase_result(experiment_id, round_number, gm_result)

                # --- Dawn phase ---
                dawn_result = engine._dawn_phase(state, gm_plan.plan)
                await self._broadcast_phase_result(experiment_id, round_number, dawn_result)

                # --- Morning actions (the slow part: 2 actions × N agents) ---
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message("phase_change", round_number=round_number, phase="morning",
                                  data={"status": "agents_deciding"}),
                )
                morning_result, morning_turns = await self._action_phase_streaming(
                    engine, state, experiment_id, round_number,
                    phase="morning", actions_per_agent=2,
                )

                # --- Midday (town meeting) ---
                midday_result = engine._midday_phase(state)
                await self._broadcast_phase_result(experiment_id, round_number, midday_result)

                # --- Afternoon actions (1 action × N agents) ---
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message("phase_change", round_number=round_number, phase="afternoon",
                                  data={"status": "agents_deciding"}),
                )
                afternoon_result, afternoon_turns = await self._action_phase_streaming(
                    engine, state, experiment_id, round_number,
                    phase="afternoon", actions_per_agent=1,
                )

                # --- Night phase ---
                cooperation_ratio = engine._calculate_cooperation_ratio(
                    [*morning_turns.values(), *afternoon_turns.values()]
                )
                night_result = engine._night_phase(state, cooperation_ratio)
                await self._broadcast_phase_result(experiment_id, round_number, night_result)

                # --- Finalize state ---
                state.current_round = round_number
                state.world_state.threat_level = (
                    night_result.cooperation_ratio or state.world_state.threat_level
                )
                engine._update_experiment_status(state)
                state.recent_events.extend(
                    event.summary
                    for phase in [gm_result, dawn_result, morning_result, midday_result, afternoon_result, night_result]
                    for event in phase.events
                )
                state.recent_events = state.recent_events[-20:]
                state.gm_plan = gm_plan

                round_result = RoundResult(
                    round_number=round_number,
                    gm_plan=gm_plan,
                    phases=[gm_result, dawn_result, morning_result, midday_result, afternoon_result, night_result],
                    cooperation_ratio=cooperation_ratio,
                    threat_level=state.world_state.threat_level,
                    world_state=state.world_state.model_copy(deep=True),
                    agent_turns={**morning_turns, **afternoon_turns},
                    created_at=datetime.now(UTC),
                )

                await self.store.save_state(state)
                await self.store.record_round_result(experiment_id, round_result)
                await self._log_round_result(experiment_id, round_result)

            # Broadcast round_end with full state so FE can do a final sync
            await self.connection_manager.broadcast(
                experiment_id,
                self._message(
                    "round_end",
                    round_number=round_number,
                    data={
                        "status": state.status,
                        "current_round": state.current_round,
                        "total_rounds": state.total_rounds,
                        "threat_level": state.world_state.threat_level,
                        "resources": state.world_state.resources.model_dump(mode="json"),
                        "agents": [
                            {
                                "agent_id": a.agent_id,
                                "name": a.name,
                                "character_id": a.character_id,
                                "status": a.status.value if hasattr(a.status, "value") else str(a.status),
                                "location": a.location,
                                "suspicion_level": a.suspicion_level,
                                "faction_id": a.faction_id,
                                "faction_role": a.faction_role,
                                "influence": a.influence,
                            }
                            for a in state.agents
                        ],
                    },
                ),
            )
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Background step failed for %s", experiment_id)

    async def _action_phase_streaming(
        self,
        engine: SimulationEngine,
        state: SimulationState,
        experiment_id: str,
        round_number: int,
        *,
        phase: str,
        actions_per_agent: int,
    ) -> tuple[PhaseResult, dict[str, list[Any]]]:
        """Run action phase, broadcasting each agent's decision as it completes."""
        from app.agents.models import AgentTurnResult
        from app.engine.models import PhaseResult, RoundEvent, build_agent_context

        all_turns: dict[str, list[AgentTurnResult]] = {}
        actions: list[tuple[EngineAgentState, AgentTurnResult]] = []

        for agent in engine._active_agents(state):
            turns = []
            for _ in range(actions_per_agent):
                context = build_agent_context(
                    agent,
                    experiment_id=state.experiment_id,
                    world_state=state.world_state,
                    current_crisis=state.gm_plan.plan.crisis_event.model_dump(mode="json")
                    if state.gm_plan
                    else None,
                    observations=engine._build_observations(agent, state),
                )
                turn = await engine.agent_service.decide(context)
                turns.append(turn)
                actions.append((agent, turn))
                agent.memory = turn.updated_memory
                agent.suspicion_level = turn.suspicion_level
                if turn.decision.action.location:
                    agent.location = turn.decision.action.location

                # Broadcast this agent's action immediately
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message(
                        "agent_action",
                        round_number=round_number,
                        phase=phase,
                        data={
                            "agent_id": agent.agent_id,
                            "agent_name": agent.name,
                            "action": turn.decision.action.model_dump(mode="json"),
                            "inner_thought": turn.decision.inner_thought,
                            "cooperation_intent": turn.decision.cooperation_intent,
                            "goal_progress": turn.decision.goal_progress,
                        },
                    ),
                )
            all_turns[agent.agent_id] = turns

        result = engine._resolve_actions(state, phase=phase, actions=actions)
        await self._broadcast_phase_result(experiment_id, round_number, result)
        return result, all_turns

    async def _broadcast_phase_start(
        self, experiment_id: str, round_number: int, gm_plan: GMPlanRecord
    ) -> None:
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "round_start",
                round_number=round_number,
                data={"theme": gm_plan.plan.round_theme},
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "gm_plan",
                round_number=round_number,
                data=gm_plan.model_dump(mode="json"),
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "crisis_event",
                round_number=round_number,
                phase="dawn",
                data=gm_plan.plan.crisis_event.model_dump(mode="json"),
            ),
        )

    async def _broadcast_phase_result(
        self, experiment_id: str, round_number: int, phase_result: PhaseResult
    ) -> None:
        await self.connection_manager.broadcast(
            experiment_id,
            self._message(
                "phase_change",
                round_number=round_number,
                phase=phase_result.phase,
                data={"events": [e.model_dump(mode="json") for e in phase_result.events]},
            ),
        )
        # Broadcast individual event types
        for event in phase_result.events:
            kind = event.data.get("kind")
            msg_type = {
                "agent_speak": "agent_speak",
                "meeting_start": "meeting_start",
                "meeting_speech": "meeting_speech",
                "meeting_vote": "meeting_vote",
                "meeting_result": "meeting_result",
                "faction_update": "faction_update",
                "cult_activity": "cult_activity",
                "exile_vote": "exile_vote",
                "exile_enacted": "exile_result",
            }.get(kind)  # type: ignore[arg-type]
            if msg_type:
                await self.connection_manager.broadcast(
                    experiment_id,
                    self._message(
                        msg_type,
                        round_number=round_number,
                        phase=phase_result.phase,
                        data=event.data,
                    ),
                )

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

    async def get_analytics_summary(self, experiment_id: str) -> AnalyticsSummary:
        state = await self.get_state(experiment_id)
        active_agents = [agent for agent in state.agents if agent.status != "exiled"]
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

    async def get_relationship_analytics(self, experiment_id: str) -> list[RelationshipEdge]:
        state = await self.get_state(experiment_id)
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
        rounds: list[ReplayRound] = []
        for round_number, snapshot in snapshots:
            round_logs = [item for item in logs if item.round_number == round_number]
            summary = round_logs[-1].summary if round_logs else f"Round {round_number} concluded."
            raw_threat = snapshot.get("threat_level", 0.0)
            threat_level = float(raw_threat) if isinstance(raw_threat, (int, float, str)) else 0.0
            rounds.append(
                ReplayRound(
                    round_number=round_number,
                    summary=summary,
                    threat_level=threat_level,
                    event_count=len(round_logs),
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
        agent_actions = [
            item
            for item in logs
            if item.type == "agent_action" and isinstance(item.data.get("action"), dict)
        ]
        if not agent_actions:
            return 0.0
        cooperative_actions = {
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
        cooperative = sum(
            1 for item in agent_actions if item.data["action"].get("type") in cooperative_actions
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

    async def _log_round_result(self, experiment_id: str, round_result: RoundResult) -> None:
        kind_to_type: dict[str, EventLogType] = {
            "faction_update": "faction_update",
            "cult_activity": "cult_activity",
            "exile_vote": "exile_vote",
            "exile_enacted": "exile_enacted",
        }
        for phase in round_result.phases:
            for event in phase.events:
                event_type = kind_to_type.get(str(event.data.get("kind")), event.phase)
                await self._log(
                    experiment_id,
                    event_type=event_type,
                    summary=event.summary,
                    round_number=round_result.round_number,
                    phase=event.phase,
                    data=event.data,
                )


runtime = ExperimentRuntime()
