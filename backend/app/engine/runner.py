from __future__ import annotations

import logging
import uuid
from typing import Any

from app.agents.mock_brain import MockAgentBrain
from app.agents.models import AgentMemoryState, PersonalityAxes, PersonalityProfile, SecretGoal
from app.agents.service import AgentService
from app.api.ws_manager import ConnectionManager
from app.engine.models import EngineAgentState, RoundResult, SimulationState
from app.engine.service import SimulationEngine
from app.gm.models import GMPlanRecord
from app.gm.presets import get_preset_arc
from app.world import resolve_spawn_tile
from app.world.models import ResourceState, WorldState

logger = logging.getLogger(__name__)


class ExperimentRunner:
    def __init__(self, ws_manager: ConnectionManager, *, use_mock: bool = True) -> None:
        self.ws_manager = ws_manager
        self.use_mock = use_mock
        self._experiments: dict[str, SimulationState] = {}
        self._engines: dict[str, SimulationEngine] = {}
        self._pending_plans: dict[str, GMPlanRecord] = {}

    def create_experiment(
        self,
        *,
        name: str,
        agents: list[dict[str, Any]],
        arc_id: str,
        total_rounds: int = 15,
        starting_resources: float = 100.0,
        auto_approve: bool = False,
    ) -> SimulationState:
        experiment_id = str(uuid.uuid4())

        arc = get_preset_arc(arc_id)

        resource_factor = starting_resources / 100.0
        resources = ResourceState(
            food=round(24.0 * resource_factor, 1),
            water=round(30.0 * resource_factor, 1),
            materials=round(14.0 * resource_factor, 1),
            power=round(10.0 * resource_factor, 1),
        )

        engine_agents: list[EngineAgentState] = []
        for agent_data in agents:
            spawn_tile = resolve_spawn_tile("town_square")
            axes_data = agent_data.get("personalityAxes", {})
            axes = PersonalityAxes(
                paranoia=axes_data.get("paranoia", 50),
                empathy=axes_data.get("empathy", 50),
                dominance=axes_data.get("dominance", 50),
                impulsiveness=axes_data.get("impulsiveness", 50),
                loyalty=axes_data.get("loyalty", 50),
                ambition=axes_data.get("ambition", 50),
            )
            personality = PersonalityProfile(
                axes=axes,
                trait_tags=agent_data.get("personality", ["cautious", "observant"]),
            )
            goal_text = agent_data.get("secretGoal", "Survive and observe.")
            goal = SecretGoal(
                archetype=agent_data.get("goalArchetype", "communal_survival")
                or "communal_survival",
                text=goal_text,
            )
            engine_agents.append(
                EngineAgentState(
                    agent_id=agent_data.get("id", str(uuid.uuid4())),
                    name=agent_data.get("name", f"Agent-{len(engine_agents) + 1}"),
                    personality=personality,
                    goal=goal,
                    memory=AgentMemoryState(),
                    location="town_square",
                    tile_x=spawn_tile[0],
                    tile_y=spawn_tile[1],
                    llm_model=agent_data.get("llmModel", "openai/gpt-4o-mini"),
                )
            )

        state = SimulationState(
            experiment_id=experiment_id,
            experiment_name=name,
            total_rounds=total_rounds,
            current_round=0,
            status="setup",
            auto_approve=auto_approve,
            arc=arc,
            world_state=WorldState(
                map_name="default_town",
                round_number=0,
                resources=resources,
                threat_level=0.0,
            ),
            agents=engine_agents,
        )

        self._experiments[experiment_id] = state

        agent_service = None
        if self.use_mock:
            agent_service = AgentService(brain=MockAgentBrain())
        self._engines[experiment_id] = SimulationEngine(
            agent_service=agent_service,
            random_seed=hash(experiment_id) % 10000,
        )

        logger.info("Created experiment %s with %d agents", experiment_id, len(engine_agents))
        return state

    def get_experiment(self, experiment_id: str) -> SimulationState | None:
        return self._experiments.get(experiment_id)

    def start_experiment(self, experiment_id: str) -> SimulationState:
        state = self._experiments[experiment_id]
        state.status = "running"
        return state

    def pause_experiment(self, experiment_id: str) -> SimulationState:
        state = self._experiments[experiment_id]
        state.status = "paused"
        return state

    async def step_round(self, experiment_id: str) -> RoundResult:
        state = self._experiments[experiment_id]
        engine = self._engines[experiment_id]

        if state.status not in ("running", "paused"):
            state.status = "running"

        round_number = state.current_round + 1

        await self.ws_manager.send_event(
            experiment_id,
            "round_start",
            round_number,
            {"round": round_number, "total_rounds": state.total_rounds},
        )

        result = await engine.run_round(state)

        await self._broadcast_round_results(experiment_id, result)

        if state.current_round >= state.total_rounds:
            state.status = "completed"
            await self.ws_manager.send_event(
                experiment_id,
                "experiment_end",
                result.round_number,
                {"reason": "all_rounds_complete", "final_threat": result.threat_level},
            )

        return result

    async def step_gm_plan_only(self, experiment_id: str) -> dict[str, Any]:
        state = self._experiments[experiment_id]
        engine = self._engines[experiment_id]

        if state.status not in ("running", "paused"):
            state.status = "running"

        round_number = state.current_round + 1
        _, gm_plan = await engine._gm_plan_phase(state, round_number)

        self._pending_plans[experiment_id] = gm_plan

        plan_data: dict[str, Any] = gm_plan.plan.model_dump(mode="json")
        await self.ws_manager.send_event(
            experiment_id,
            "gm_plan",
            round_number,
            plan_data,
            phase="gm_plan",
        )

        return plan_data

    async def approve_plan(
        self, experiment_id: str, modified_plan: dict[str, Any] | None = None
    ) -> RoundResult:
        state = self._experiments[experiment_id]
        engine = self._engines[experiment_id]

        pending = self._pending_plans.pop(experiment_id, None)
        if pending:
            if modified_plan:
                from app.gm.models import GMPlanData

                pending = GMPlanRecord(
                    status="modified",
                    plan=GMPlanData.model_validate(modified_plan),
                )
            else:
                pending = GMPlanRecord(status="approved", plan=pending.plan)
            state.gm_plan = pending

        result = await engine.run_round(state)
        await self._broadcast_round_results(experiment_id, result)

        if state.current_round >= state.total_rounds:
            state.status = "completed"
            await self.ws_manager.send_event(
                experiment_id,
                "experiment_end",
                result.round_number,
                {"reason": "all_rounds_complete", "final_threat": result.threat_level},
            )

        return result

    async def _broadcast_round_results(self, experiment_id: str, result: RoundResult) -> None:
        eid = experiment_id
        rn = result.round_number

        for phase_result in result.phases:
            await self.ws_manager.send_event(
                eid,
                "phase_change",
                rn,
                {"phase": phase_result.phase},
                phase=phase_result.phase,
            )

            for event in phase_result.events:
                if phase_result.phase in ("morning", "afternoon"):
                    agent_id = event.data.get("agent_id")
                    action_type = event.data.get("action_type")
                    if agent_id and action_type:
                        await self.ws_manager.send_event(
                            eid,
                            "agent_action",
                            rn,
                            {
                                "agent_id": agent_id,
                                "action": action_type,
                                "summary": event.summary,
                            },
                            phase=phase_result.phase,
                        )

                if phase_result.phase == "dawn":
                    crisis_data = event.data.get("crisis_event")
                    if crisis_data and isinstance(crisis_data, dict):
                        await self.ws_manager.send_event(
                            eid,
                            "crisis_event",
                            rn,
                            crisis_data,
                            phase="dawn",
                        )
                    await self.ws_manager.send_event(
                        eid,
                        "gm_narration",
                        rn,
                        {"text": event.summary},
                        phase="dawn",
                    )

                if phase_result.phase == "midday":
                    meeting_data: dict[str, Any] = dict(event.data)
                    if "proposal" in meeting_data:
                        await self.ws_manager.send_event(
                            eid,
                            "meeting_start",
                            rn,
                            {"proposal": meeting_data.get("proposal", "")},
                            phase="midday",
                        )
                        raw_votes = meeting_data.get("votes", {})
                        votes: dict[str, Any] = (
                            dict(raw_votes) if isinstance(raw_votes, dict) else {}
                        )
                        for agent_id_v, vote in votes.items():
                            await self.ws_manager.send_event(
                                eid,
                                "meeting_vote",
                                rn,
                                {"agent_id": agent_id_v, "vote": vote},
                                phase="midday",
                            )
                        await self.ws_manager.send_event(
                            eid,
                            "meeting_result",
                            rn,
                            {"summary": meeting_data.get("summary", ""), "votes": votes},
                            phase="midday",
                        )

        for agent_id, turns in result.agent_turns.items():
            agent = next((a for a in self._experiments[eid].agents if a.agent_id == agent_id), None)
            for turn in turns:
                if turn.decision.dialogue:
                    await self.ws_manager.send_event(
                        eid,
                        "agent_speak",
                        rn,
                        {
                            "agent_id": agent_id,
                            "agent_name": agent.name if agent else agent_id,
                            "target": turn.decision.dialogue.target,
                            "message": turn.decision.dialogue.message,
                        },
                    )
                if turn.decision.action.location:
                    await self.ws_manager.send_event(
                        eid,
                        "agent_move",
                        rn,
                        {
                            "agent_id": agent_id,
                            "location": turn.decision.action.location,
                        },
                    )

        resources = result.world_state.resources.model_dump()
        await self.ws_manager.send_event(
            eid,
            "resource_update",
            rn,
            resources,
        )

        await self.ws_manager.send_event(
            eid,
            "threat_update",
            rn,
            {"threat_level": result.threat_level},
        )

        await self.ws_manager.send_event(
            eid,
            "round_end",
            rn,
            {
                "round": rn,
                "cooperation_ratio": result.cooperation_ratio,
                "threat_level": result.threat_level,
                "resources": resources,
            },
        )
