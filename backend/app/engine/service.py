from __future__ import annotations

from datetime import UTC, datetime
from random import Random
from typing import cast

from app.agents.service import AgentService
from app.engine.models import (
    ConflictRecord,
    EngineAgentState,
    MeetingOutcome,
    PhaseName,
    PhaseResult,
    RoundEvent,
    RoundResult,
    SimulationState,
    build_agent_context,
)
from app.agents.models import AgentTurnResult
from app.gm.models import GMPlanData, GMPlanRecord
from app.gm import GMPlanningContext, GMService
from app.world.models import ResourceName, ResourceTick
from app.world.service import apply_resource_tick, calculate_threat_level


class SimulationEngine:
    def __init__(
        self,
        *,
        gm_service: GMService | None = None,
        agent_service: AgentService | None = None,
        random_seed: int = 7,
    ) -> None:
        self.gm_service = gm_service or GMService()
        self.agent_service = agent_service or AgentService()
        self.random = Random(random_seed)

    async def run_round(self, state: SimulationState) -> RoundResult:
        round_number = state.current_round + 1
        state.world_state.round_number = round_number

        if (
            state.gm_plan
            and state.gm_plan.plan.round == round_number
            and state.gm_plan.status == "applied"
        ):
            gm_plan = state.gm_plan
            gm_result = PhaseResult(
                phase="gm_plan",
                events=[
                    RoundEvent(
                        phase="gm_plan",
                        summary=f"Using approved GM plan '{gm_plan.plan.round_theme}'.",
                        data={"status": gm_plan.status, "theme": gm_plan.plan.round_theme},
                    )
                ],
            )
        else:
            gm_result, gm_plan = await self._gm_plan_phase(state, round_number)
        dawn_result = self._dawn_phase(state, gm_plan.plan)
        morning_result, morning_turns = await self._action_phase(
            state, phase="morning", actions_per_agent=2
        )
        midday_result = self._midday_phase(state)
        afternoon_result, afternoon_turns = await self._action_phase(
            state, phase="afternoon", actions_per_agent=1
        )
        cooperation_ratio = self._calculate_cooperation_ratio(
            [*morning_turns.values(), *afternoon_turns.values()]
        )
        night_result = self._night_phase(state, cooperation_ratio)

        state.current_round = round_number
        state.world_state.threat_level = (
            night_result.cooperation_ratio or state.world_state.threat_level
        )
        state.recent_events.extend(
            event.summary
            for phase in [
                gm_result,
                dawn_result,
                morning_result,
                midday_result,
                afternoon_result,
                night_result,
            ]
            for event in phase.events
        )
        state.recent_events = state.recent_events[-20:]
        state.gm_plan = gm_plan

        return RoundResult(
            round_number=round_number,
            gm_plan=gm_plan,
            phases=[
                gm_result,
                dawn_result,
                morning_result,
                midday_result,
                afternoon_result,
                night_result,
            ],
            cooperation_ratio=cooperation_ratio,
            threat_level=state.world_state.threat_level,
            world_state=state.world_state.model_copy(deep=True),
            agent_turns={**morning_turns, **afternoon_turns},
            created_at=datetime.now(UTC),
        )

    async def _gm_plan_phase(
        self, state: SimulationState, round_number: int
    ) -> tuple[PhaseResult, GMPlanRecord]:
        context = GMPlanningContext(
            round_number=round_number,
            total_rounds=state.total_rounds,
            arc=state.arc,
            world_state=state.world_state,
            threat_level=state.world_state.threat_level,
            cooperation_ratio=0.6,
            unresolved_plotlines=state.unresolved_plotlines,
            relationships_summary=self._summarize_relationships(state.agents),
            recent_events=state.recent_events[-5:],
            auto_approve=state.auto_approve,
        )
        plan = await self.gm_service.generate_plan(context)
        if not state.auto_approve:
            plan = self.gm_service.approve_plan(plan)
        plan = self.gm_service.apply_plan(plan)
        state.gm_plan = plan
        result = PhaseResult(
            phase="gm_plan",
            events=[
                RoundEvent(
                    phase="gm_plan",
                    summary=f"GM prepared '{plan.plan.round_theme}'.",
                    data={"status": plan.status, "theme": plan.plan.round_theme},
                )
            ],
        )
        return result, plan

    def _dawn_phase(self, state: SimulationState, plan: GMPlanData) -> PhaseResult:
        world_bias = cast(
            dict[ResourceName, float], state.world_state.active_modifiers.get("world_bias", {})
        )
        crisis_modifiers = cast(dict[ResourceName, float], plan.resource_modifiers.model_dump())
        tick = ResourceTick(
            crisis_modifiers=crisis_modifiers,
            action_modifiers=world_bias,
        )
        state.world_state.resources = apply_resource_tick(state.world_state.resources, tick)
        state.world_state.threat_level = calculate_threat_level(
            state.world_state.resources,
            cooperation_ratio=0.6,
            crisis_severity=_severity_to_float(plan.crisis_event.severity),
        )
        state.unresolved_plotlines.append(plan.crisis_event.description)
        state.unresolved_plotlines = state.unresolved_plotlines[-10:]
        return PhaseResult(
            phase="dawn",
            events=[
                RoundEvent(
                    phase="dawn",
                    summary=plan.narration,
                    data={"crisis_event": plan.crisis_event.model_dump(mode="json")},
                )
            ],
        )

    async def _action_phase(
        self,
        state: SimulationState,
        *,
        phase: PhaseName,
        actions_per_agent: int,
    ) -> tuple[PhaseResult, dict[str, list[AgentTurnResult]]]:
        all_turns: dict[str, list[AgentTurnResult]] = {}
        actions: list[tuple[EngineAgentState, AgentTurnResult]] = []
        for agent in state.agents:
            turns = []
            for _ in range(actions_per_agent):
                context = build_agent_context(
                    agent,
                    world_state=state.world_state,
                    current_crisis=state.gm_plan.plan.crisis_event.model_dump(mode="json")
                    if state.gm_plan
                    else None,
                    observations=self._build_observations(agent, state),
                )
                turn = await self.agent_service.decide(context)
                turns.append(turn)
                actions.append((agent, turn))
                agent.memory = turn.updated_memory
                agent.suspicion_level = turn.suspicion_level
                if turn.decision.action.location:
                    agent.location = turn.decision.action.location
            all_turns[agent.agent_id] = turns

        result = self._resolve_actions(state, phase=phase, actions=actions)
        return result, all_turns

    def _midday_phase(self, state: SimulationState) -> PhaseResult:
        proposal = self._meeting_proposal(state)
        votes = {
            agent.agent_id: self.random.choice(["support", "oppose"]) for agent in state.agents
        }
        supporters = [agent_id for agent_id, vote in votes.items() if vote == "support"]
        outcome = MeetingOutcome(
            proposal=proposal,
            votes=votes,
            summary=f"The town meeting fractures around '{proposal}' with {len(supporters)} supporters.",
        )
        return PhaseResult(
            phase="midday",
            events=[
                RoundEvent(
                    phase="midday", summary=outcome.summary, data=outcome.model_dump(mode="json")
                )
            ],
        )

    def _night_phase(self, state: SimulationState, cooperation_ratio: float) -> PhaseResult:
        crisis_severity = (
            _severity_to_float(state.gm_plan.plan.crisis_event.severity) if state.gm_plan else 0.2
        )
        state.world_state.threat_level = calculate_threat_level(
            state.world_state.resources,
            cooperation_ratio=cooperation_ratio,
            crisis_severity=crisis_severity,
        )
        reflections = []
        for agent in state.agents:
            reflection = f"{agent.name} ends the night feeling {self._night_mood(agent.suspicion_level, cooperation_ratio)}."
            agent.memory = self.agent_service.register_observation(
                agent.memory,
                round_number=state.world_state.round_number,
                summary=reflection,
                emotional_charge=10,
                important=agent.suspicion_level > 40,
            )
            reflections.append(reflection)
        return PhaseResult(
            phase="night",
            events=[
                RoundEvent(
                    phase="night",
                    summary="Night consequences settle over the town.",
                    data={"reflections": reflections},
                )
            ],
            cooperation_ratio=state.world_state.threat_level,
        )

    def _resolve_actions(
        self,
        state: SimulationState,
        *,
        phase: PhaseName,
        actions: list[tuple[EngineAgentState, AgentTurnResult]],
    ) -> PhaseResult:
        grouped: dict[tuple[str, str], list[tuple[EngineAgentState, AgentTurnResult]]] = {}
        events: list[RoundEvent] = []
        conflicts: list[ConflictRecord] = []

        for agent, turn in actions:
            location = turn.decision.action.location or agent.location or "town_square"
            key = (location, turn.decision.action.type)
            grouped.setdefault(key, []).append((agent, turn))

        for (location, action_type), group in grouped.items():
            if len(group) > 1 and action_type in {
                "gather",
                "hoard",
                "repair",
                "explore",
                "accuse",
                "vote",
            }:
                winner_count = max(1, len(group) // 2)
                ordered = sorted(
                    group, key=lambda item: (item[0].suspicion_level, self.random.random())
                )
                winners = ordered[:winner_count]
                losers = ordered[winner_count:]
                summary = (
                    f"At {location}, {len(group)} agents collided over {action_type}; "
                    f"{', '.join(agent.name for agent, _ in winners)} came out ahead."
                )
                conflicts.append(
                    ConflictRecord(
                        location=location,
                        action_type=action_type,
                        participants=[agent.agent_id for agent, _ in group],
                        winner_ids=[agent.agent_id for agent, _ in winners],
                        loser_ids=[agent.agent_id for agent, _ in losers],
                        summary=summary,
                    )
                )
                self._apply_conflict_consequences(state, location, action_type, winners, losers)
                events.append(RoundEvent(phase=phase, summary=summary))
            else:
                for agent, turn in group:
                    self._apply_clean_action(state, agent, turn.decision.action.type, location)
                    events.append(
                        RoundEvent(
                            phase=phase,
                            summary=f"{agent.name} chose to {turn.decision.action.type} at {location}.",
                            data={
                                "agent_id": agent.agent_id,
                                "action_type": turn.decision.action.type,
                            },
                        )
                    )

        return PhaseResult(phase=phase, events=events, conflicts=conflicts)

    def _apply_clean_action(
        self, state: SimulationState, agent: EngineAgentState, action_type: str, location: str
    ) -> None:
        occupancy = state.world_state.location_occupancy.setdefault(location, [])
        if agent.agent_id not in occupancy:
            occupancy.append(agent.agent_id)
        self._apply_resource_effect(state, action_type)

    def _apply_conflict_consequences(
        self,
        state: SimulationState,
        location: str,
        action_type: str,
        winners: list[tuple[EngineAgentState, AgentTurnResult]],
        losers: list[tuple[EngineAgentState, AgentTurnResult]],
    ) -> None:
        for agent, _ in winners:
            occupancy = state.world_state.location_occupancy.setdefault(location, [])
            if agent.agent_id not in occupancy:
                occupancy.append(agent.agent_id)
            self._apply_resource_effect(state, action_type, chaotic_bonus=True)
        for agent, _ in losers:
            agent.suspicion_level = min(100.0, agent.suspicion_level + 3.0)

    def _apply_resource_effect(
        self, state: SimulationState, action_type: str, chaotic_bonus: bool = False
    ) -> None:
        modifier = 0.2 if chaotic_bonus else 0.0
        if action_type == "gather":
            state.world_state.resources.food = round(
                state.world_state.resources.food + 0.8 + modifier, 2
            )
            state.world_state.resources.water = round(state.world_state.resources.water + 0.5, 2)
        elif action_type == "repair":
            state.world_state.resources.materials = max(
                0.0, round(state.world_state.resources.materials - 0.7, 2)
            )
            state.world_state.resources.power = round(state.world_state.resources.power + 0.3, 2)
        elif action_type == "hoard":
            state.world_state.resources.food = max(
                0.0, round(state.world_state.resources.food - 0.6, 2)
            )
        elif action_type == "sabotage":
            state.world_state.resources.power = max(
                0.0, round(state.world_state.resources.power - 0.9, 2)
            )

    def _meeting_proposal(self, state: SimulationState) -> str:
        if state.world_state.threat_level > 50:
            return "Emergency rationing until the next dawn"
        if state.gm_plan and state.gm_plan.plan.crisis_event.type in {"social", "discovery"}:
            return "Investigate whoever is spreading lies"
        return "Share watch duty at the fence tonight"

    def _calculate_cooperation_ratio(self, turn_groups: list[list[AgentTurnResult]]) -> float:
        cooperative = 0
        total = 0
        for turns in turn_groups:
            for turn in turns:
                total += 1
                if turn.decision.action.type in {
                    "gather",
                    "repair",
                    "talk",
                    "trade",
                    "rest",
                    "observe",
                }:
                    cooperative += 1
        if total == 0:
            return 0.5
        return round(cooperative / total, 2)

    def _build_observations(
        self, agent: EngineAgentState, state: SimulationState
    ) -> list[dict[str, object]]:
        observations = [
            {"summary": f"Threat is currently {state.world_state.threat_level}.", "importance": 4},
            {
                "summary": f"Resources are {state.world_state.resources.model_dump()}.",
                "importance": 3,
            },
        ]
        if state.gm_plan:
            observations.append(
                {"summary": state.gm_plan.plan.crisis_event.description, "importance": 5}
            )
        if agent.location == "perimeter_fence":
            observations.append(
                {"summary": "The fence seems wrong from up close.", "importance": 5}
            )
        return observations

    def _summarize_relationships(self, agents: list[EngineAgentState]) -> str:
        fragments: list[str] = []
        for agent in agents[:4]:
            if agent.relationships:
                fragments.append(f"{agent.name} carries {len(agent.relationships)} active ties.")
        return " ".join(fragments) or "Relationships remain unstable and underdefined."

    def _night_mood(self, suspicion_level: float, cooperation_ratio: float) -> str:
        if suspicion_level > 60:
            return "haunted"
        if cooperation_ratio < 0.4:
            return "cornered"
        return "unsettled"


def _severity_to_float(severity: str) -> float:
    return {
        "low": 0.2,
        "medium": 0.45,
        "high": 0.7,
        "critical": 1.0,
    }.get(severity, 0.3)
