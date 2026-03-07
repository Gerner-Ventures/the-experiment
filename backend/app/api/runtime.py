from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder

from app.agents.models import AgentMemoryState
from app.api.models import CreateExperimentRequest, EventLogItem, EventLogType
from app.engine import EngineAgentState, RoundResult, SimulationEngine, SimulationState
from app.gm import GMService, get_preset_arc
from app.gm.models import DirectorArc, GMPlanData, GMPlanRecord, GMPlanningContext
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
    def __init__(self) -> None:
        self.engine = SimulationEngine()
        self.gm_service = GMService()
        self.connection_manager = ConnectionManager()
        self.states: dict[str, SimulationState] = {}
        self.logs: defaultdict[str, list[EventLogItem]] = defaultdict(list)
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
            self.states[experiment_id] = state
            self._log(
                experiment_id,
                event_type="experiment_created",
                summary=f"Experiment '{request.name}' created.",
            )
            return state

    def get_state(self, experiment_id: str) -> SimulationState:
        return self.states[experiment_id]

    def start(self, experiment_id: str) -> SimulationState:
        state = self.get_state(experiment_id)
        state.status = "running"
        self._log(experiment_id, event_type="experiment_started", summary="Experiment started.")
        return state

    def pause(self, experiment_id: str) -> SimulationState:
        state = self.get_state(experiment_id)
        state.status = "paused"
        self._log(experiment_id, event_type="experiment_paused", summary="Experiment paused.")
        return state

    def inject_observer_event(self, experiment_id: str, description: str) -> SimulationState:
        state = self.get_state(experiment_id)
        state.unresolved_plotlines.append(description)
        state.unresolved_plotlines = state.unresolved_plotlines[-10:]
        for agent in state.agents:
            agent.suspicion_level = min(100.0, agent.suspicion_level + 6.0)
        self._log(experiment_id, event_type="observer_event", summary=description)
        self._schedule_broadcast(
            experiment_id,
            self._message(
                "observer_event",
                round_number=state.current_round,
                data={"description": description},
            ),
        )
        return state

    def update_arc(self, experiment_id: str, arc: DirectorArc) -> SimulationState:
        state = self.get_state(experiment_id)
        state.arc = arc
        self._log(experiment_id, event_type="arc_updated", summary=f"Arc updated to '{arc.name}'.")
        return state

    async def get_or_generate_gm_plan(self, experiment_id: str) -> GMPlanRecord:
        state = self.get_state(experiment_id)
        next_round = state.current_round + 1
        if state.gm_plan and state.gm_plan.plan.round == next_round:
            return state.gm_plan
        context = GMPlanningContext(
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
        self._log(
            experiment_id,
            event_type="gm_plan_generated",
            summary=plan.plan.round_theme,
            round_number=next_round,
        )
        return plan

    async def approve_gm_plan(
        self, experiment_id: str, modified_plan: GMPlanData | None = None
    ) -> GMPlanRecord:
        state = self.get_state(experiment_id)
        record = await self.get_or_generate_gm_plan(experiment_id)
        approved = self.gm_service.approve_plan(record, modified_plan=modified_plan)
        applied = self.gm_service.apply_plan(approved)
        state.gm_plan = applied
        self._log(
            experiment_id,
            event_type="gm_plan_approved",
            summary=applied.plan.round_theme,
            round_number=applied.plan.round,
        )
        return applied

    async def step(self, experiment_id: str) -> tuple[RoundResult, SimulationState]:
        state = self.get_state(experiment_id)
        if state.status == "setup":
            state.status = "running"
        if not state.auto_approve:
            await self.approve_gm_plan(experiment_id)
        round_result = await self.engine.run_round(state)
        self._log_round_result(experiment_id, round_result)
        await self.broadcast_round(experiment_id, round_result)
        return round_result, state

    def list_agents(self, experiment_id: str) -> list[EngineAgentState]:
        return self.get_state(experiment_id).agents

    def get_agent(self, experiment_id: str, agent_id: str) -> EngineAgentState:
        for agent in self.get_state(experiment_id).agents:
            if agent.agent_id == agent_id:
                return agent
        raise KeyError(agent_id)

    def get_log(
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
        items = self.logs[experiment_id]
        filtered = [
            item
            for item in items
            if (phase is None or item.phase == phase)
            and (event_type is None or item.type == event_type)
            and (agent_id is None or item.agent_id == agent_id)
            and (round_number is None or item.round_number == round_number)
        ]
        return filtered[offset : offset + limit], len(filtered)

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
        state = self.get_state(experiment_id)
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

    def _log(
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
        self.logs[experiment_id].append(
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

    def _log_round_result(self, experiment_id: str, round_result: RoundResult) -> None:
        for phase in round_result.phases:
            for event in phase.events:
                self._log(
                    experiment_id,
                    event_type=event.phase,
                    summary=event.summary,
                    round_number=round_result.round_number,
                    phase=event.phase,
                    data=event.data,
                )


runtime = ExperimentRuntime()
