from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from random import Random
from typing import cast

from app.agents.memory import append_recent_event
from app.agents.models import AgentMemoryState, AgentTurnResult, MemoryEvent
from app.agents.suspicion import apply_suspicion_trigger
from app.agents.service import AgentService
from app.db.models import AgentStatus
from app.engine.models import (
    ConflictRecord,
    ConversationOutcome,
    EngineAgentState,
    MeetingOutcome,
    PhaseName,
    PhaseResult,
    RoundEvent,
    RoundResult,
    SacrificeOutcome,
    SimulationState,
    build_agent_context,
)
from app.gm.models import GMPlanData, GMPlanRecord
from app.gm import GMPlanningContext, GMService
from app.social import SocialService
from app.world.models import ResourceName, ResourceTick
from app.world.service import (
    apply_resource_tick,
    calculate_threat_level,
    get_location_type,
    location_label_for_tile,
    resolve_location_target,
    resolve_spawn_tile,
    step_toward,
    tile_distance,
)


@dataclass
class PreparedAction:
    agent: EngineAgentState
    turn: AgentTurnResult
    action_type: str
    location: str
    summary: str | None = None


class SimulationEngine:
    SELF_SACRIFICE_THREAT_DELTA = -8.0
    SELF_SACRIFICE_RESOURCE_EFFECTS = {"food": 1.0, "materials": 0.8}
    SELF_SACRIFICE_SUSPICION_DELTA = 9.0
    MAX_MOVE_TILES_PER_ACTION = 2
    CONTACT_RANGE_TILES = 2
    RANGED_CONTACT_RANGE_TILES = 4
    AGENT_INTERACTION_ACTIONS = {
        "talk",
        "trade",
        "accuse",
        "vote",
        "attack",
        "threaten",
        "stab",
        "shoot",
        "poison",
        "argue",
        "investigate",
    }
    RANGED_ACTIONS = {"shoot"}
    ACTION_LOCATION_RULES: dict[str, set[str]] = {
        "gather": {"farm", "water_source", "store"},
        "repair": {"workshop", "meeting_hall", "boundary", "mystery"},
        "hoard": {"farm", "water_source", "store", "residence", "bar", "brothel"},
        "vote": {"meeting_hall"},
    }

    def __init__(
        self,
        *,
        gm_service: GMService | None = None,
        agent_service: AgentService | None = None,
        social_service: SocialService | None = None,
        random_seed: int = 7,
    ) -> None:
        self.gm_service = gm_service or GMService()
        self.agent_service = agent_service or AgentService()
        self.social_service = social_service or SocialService(random_seed=random_seed + 10)
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
        night_result = await self._night_phase(state, cooperation_ratio)

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
        actions: list[PreparedAction] = []
        for agent in self._active_agents(state):
            self._ensure_agent_position(agent)
        for agent in self._active_agents(state):
            turns = []
            for _ in range(actions_per_agent):
                context = build_agent_context(
                    agent,
                    experiment_id=state.experiment_id,
                    world_state=state.world_state,
                    current_crisis=state.gm_plan.plan.crisis_event.model_dump(mode="json")
                    if state.gm_plan
                    else None,
                    observations=self._build_observations(agent, state),
                )
                turn = await self.agent_service.decide(context)
                turns.append(turn)
                agent.memory = turn.updated_memory
                agent.suspicion_level = turn.suspicion_level
                prepared = self._prepare_action(state, agent, turn)
                actions.append(prepared)
                if prepared.action_type == "self_sacrifice":
                    break
            all_turns[agent.agent_id] = turns

        result = await self._resolve_actions(state, phase=phase, actions=actions)
        return result, all_turns

    def _midday_phase(self, state: SimulationState) -> PhaseResult:
        proposal = self._meeting_proposal(state)
        outcome = self.social_service.run_meeting(state, proposal=proposal)
        self._apply_meeting_relationships(state, outcome)

        events = [
            RoundEvent(
                phase="midday",
                summary=f"The town meeting opens around '{proposal}'.",
                data={
                    "kind": "meeting_start",
                    "proposal": proposal,
                },
            )
        ]
        for speech in outcome.speeches:
            events.append(
                RoundEvent(
                    phase="midday",
                    summary=speech.content,
                    data={
                        "kind": "meeting_speech",
                        "agent_id": speech.agent_id,
                        "agent_name": speech.agent_name,
                        "stance": speech.stance,
                        "content": speech.content,
                    },
                )
            )
        for agent in self._active_agents(state):
            events.append(
                RoundEvent(
                    phase="midday",
                    summary=outcome.vote_rationales[agent.agent_id],
                    data={
                        "kind": "meeting_vote",
                        "agent_id": agent.agent_id,
                        "agent_name": agent.name,
                        "vote": outcome.votes[agent.agent_id],
                    },
                )
            )
        events.append(
            RoundEvent(
                phase="midday",
                summary=outcome.summary,
                data={"kind": "meeting_result", **outcome.model_dump(mode="json")},
            )
        )
        return PhaseResult(
            phase="midday",
            events=events,
        )

    async def _night_phase(self, state: SimulationState, cooperation_ratio: float) -> PhaseResult:
        crisis_severity = (
            _severity_to_float(state.gm_plan.plan.crisis_event.severity) if state.gm_plan else 0.2
        )
        state.world_state.threat_level = calculate_threat_level(
            state.world_state.resources,
            cooperation_ratio=cooperation_ratio,
            crisis_severity=crisis_severity,
        )
        active_agents = self._active_agents(state)
        night_updates = await asyncio.gather(
            *[
                self._build_night_reflection(
                    agent,
                    round_number=state.world_state.round_number,
                    cooperation_ratio=cooperation_ratio,
                )
                for agent in active_agents
            ]
        )
        reflections = []
        for agent, (reflection, updated_memory) in zip(active_agents, night_updates, strict=True):
            agent.memory = updated_memory
            agent.relationships = dict(agent.memory.relationship_memory)
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

    async def _build_night_reflection(
        self,
        agent: EngineAgentState,
        *,
        round_number: int,
        cooperation_ratio: float,
    ) -> tuple[str, AgentMemoryState]:
        reflection = f"{agent.name} ends the night feeling {self._night_mood(agent.suspicion_level, cooperation_ratio)}."
        updated_memory = await self.agent_service.register_observation(
            agent.memory,
            round_number=round_number,
            summary=reflection,
            emotional_charge=10,
            important=agent.suspicion_level > 40,
            goal=agent.goal,
            suspicion_level=agent.suspicion_level,
        )
        updated_memory = await self.agent_service.consolidate_memory(
            updated_memory,
            goal=agent.goal,
            suspicion_level=agent.suspicion_level,
        )
        updated_memory = await self.agent_service.consolidate_relationship_memory(
            updated_memory,
            goal=agent.goal,
            suspicion_level=agent.suspicion_level,
        )
        return reflection, updated_memory

    async def _resolve_actions(
        self,
        state: SimulationState,
        *,
        phase: PhaseName,
        actions: list[PreparedAction],
    ) -> PhaseResult:
        grouped: dict[tuple[str, str], list[PreparedAction]] = {}
        events: list[RoundEvent] = []
        conflicts: list[ConflictRecord] = []

        for prepared in actions:
            key = (prepared.location, prepared.action_type)
            grouped.setdefault(key, []).append(prepared)

        for (location, action_type), group in grouped.items():
            if action_type == "talk" and len(group) > 1:
                outcomes = self.social_service.run_conversations(
                    state,
                    location=location,
                    participants=[prepared.agent for prepared in group],
                )
                await self._apply_conversation_outcomes(state, outcomes)
                for outcome in outcomes:
                    events.extend(self._conversation_events(phase, outcome))
                continue
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
                    group, key=lambda item: (item.agent.suspicion_level, self.random.random())
                )
                winners = ordered[:winner_count]
                losers = ordered[winner_count:]
                summary = (
                    f"At {location}, {len(group)} agents collided over {action_type}; "
                    f"{', '.join(prepared.agent.name for prepared in winners)} came out ahead."
                )
                conflicts.append(
                    ConflictRecord(
                        location=location,
                        action_type=action_type,
                        participants=[prepared.agent.agent_id for prepared in group],
                        winner_ids=[prepared.agent.agent_id for prepared in winners],
                        loser_ids=[prepared.agent.agent_id for prepared in losers],
                        summary=summary,
                    )
                )
                self._apply_conflict_consequences(state, location, action_type, winners, losers)
                events.append(RoundEvent(phase=phase, summary=summary))
            else:
                for prepared in group:
                    agent = prepared.agent
                    turn = prepared.turn
                    sacrifice = None
                    if prepared.action_type == "self_sacrifice":
                        sacrifice = self._apply_self_sacrifice(state, agent, location)
                    else:
                        self._apply_clean_action(state, agent, prepared.action_type, location)
                    events.append(
                        RoundEvent(
                            phase=phase,
                            summary=(
                                sacrifice.reason
                                if sacrifice is not None
                                else prepared.summary
                                or f"{agent.name} chose to {prepared.action_type} at {location}."
                            ),
                            data={
                                "agent_id": agent.agent_id,
                                "action_type": prepared.action_type,
                                "requested_action_type": turn.decision.action.type,
                                **(
                                    {
                                        "kind": "self_sacrifice",
                                        "sacrifice": sacrifice.model_dump(mode="json"),
                                    }
                                    if sacrifice is not None
                                    else {}
                                ),
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
        winners: list[PreparedAction],
        losers: list[PreparedAction],
    ) -> None:
        for prepared in winners:
            agent = prepared.agent
            occupancy = state.world_state.location_occupancy.setdefault(location, [])
            if agent.agent_id not in occupancy:
                occupancy.append(agent.agent_id)
            self._apply_resource_effect(state, action_type, chaotic_bonus=True)
        for prepared in losers:
            agent = prepared.agent
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

    def _apply_self_sacrifice(
        self, state: SimulationState, agent: EngineAgentState, location: str
    ) -> SacrificeOutcome:
        occupancy = state.world_state.location_occupancy.setdefault(location, [])
        if agent.agent_id not in occupancy:
            occupancy.append(agent.agent_id)

        state.world_state.resources.food = round(
            state.world_state.resources.food + self.SELF_SACRIFICE_RESOURCE_EFFECTS["food"], 2
        )
        state.world_state.resources.materials = round(
            state.world_state.resources.materials
            + self.SELF_SACRIFICE_RESOURCE_EFFECTS["materials"],
            2,
        )
        state.world_state.threat_level = max(
            0.0,
            round(state.world_state.threat_level + self.SELF_SACRIFICE_THREAT_DELTA, 2),
        )

        agent.status = AgentStatus.DEAD
        agent.location = location
        agent.faction_id = None
        agent.faction_role = None
        agent.influence = 0.0
        agent.death_round = state.world_state.round_number
        agent.death_cause = "self_sacrifice"

        witness_ids: list[str] = []
        for witness in self._active_agents(state):
            if witness.agent_id == agent.agent_id:
                continue
            witness_ids.append(witness.agent_id)
            witness.suspicion_level = min(
                100.0, round(witness.suspicion_level + self.SELF_SACRIFICE_SUSPICION_DELTA, 2)
            )
            witness.memory = append_recent_event(
                witness.memory,
                MemoryEvent(
                    round_number=state.world_state.round_number,
                    summary=f"{agent.name} gave up their life at {location}, and the town froze.",
                    emotional_charge=35,
                    tags=["self_sacrifice", "death", location],
                ),
            )

        outcome = SacrificeOutcome(
            round_number=state.world_state.round_number,
            agent_id=agent.agent_id,
            agent_name=agent.name,
            location=location,
            reason=(
                f"{agent.name} performs a ritual self-sacrifice at {location}, "
                "shocking the town into temporary order."
            ),
            threat_delta=self.SELF_SACRIFICE_THREAT_DELTA,
            resource_effects=dict(self.SELF_SACRIFICE_RESOURCE_EFFECTS),
            witness_ids=witness_ids,
        )
        state.sacrifice_history.append(outcome)
        state.sacrifice_history = state.sacrifice_history[-12:]
        return outcome

    def _meeting_proposal(self, state: SimulationState) -> str:
        if state.world_state.threat_level > 50:
            return "Emergency rationing until the next dawn"
        if state.gm_plan and state.gm_plan.plan.crisis_event.type in {"social", "discovery"}:
            return "Investigate whoever is spreading lies"
        return "Share watch duty at the fence tonight"

    async def _apply_conversation_outcomes(
        self, state: SimulationState, outcomes: list[ConversationOutcome]
    ) -> None:
        agents = {agent.agent_id: agent for agent in state.agents}
        for outcome in outcomes:
            for turn in outcome.turns:
                speaker = agents[turn.speaker_id]
                listener = agents[turn.listener_id]
                speaker.memory = await self.agent_service.register_observation(
                    speaker.memory,
                    round_number=state.world_state.round_number,
                    summary=turn.content,
                    emotional_charge=8,
                    goal=speaker.goal,
                    suspicion_level=speaker.suspicion_level,
                    classify=False,
                )
                listener.memory = await self.agent_service.register_observation(
                    listener.memory,
                    round_number=state.world_state.round_number,
                    summary=turn.content,
                    emotional_charge=6,
                    goal=listener.goal,
                    suspicion_level=listener.suspicion_level,
                    classify=False,
                )
                speaker.memory = self.agent_service.update_relationship(
                    speaker.memory,
                    other_agent_id=listener.agent_id,
                    trust_delta=turn.trust_delta,
                    note=turn.content,
                )
                speaker.relationships = dict(speaker.memory.relationship_memory)
                listener.memory = self.agent_service.update_relationship(
                    listener.memory,
                    other_agent_id=speaker.agent_id,
                    trust_delta=turn.trust_delta,
                    note=turn.content,
                )
                listener.relationships = dict(listener.memory.relationship_memory)
                occupancy = state.world_state.location_occupancy.setdefault(outcome.location, [])
                for participant_id in outcome.participants:
                    if participant_id not in occupancy:
                        occupancy.append(participant_id)

    def _apply_meeting_relationships(self, state: SimulationState, outcome: MeetingOutcome) -> None:
        agents = {agent.agent_id: agent for agent in self._active_agents(state)}
        for source in self._active_agents(state):
            for target in self._active_agents(state):
                if source.agent_id == target.agent_id:
                    continue
                delta = self.social_service.relationship_delta_for_vote(
                    source,
                    target,
                    source_vote=outcome.votes[source.agent_id],
                    target_vote=outcome.votes[target.agent_id],
                )
                if delta == 0:
                    continue
                note = (
                    f"Meeting vote on '{outcome.proposal}' split {source.name} "
                    f"({outcome.votes[source.agent_id]}) from {target.name} "
                    f"({outcome.votes[target.agent_id]})."
                )
                source.memory = self.agent_service.update_relationship(
                    source.memory,
                    other_agent_id=target.agent_id,
                    trust_delta=delta,
                    note=note,
                )
                source.relationships = dict(source.memory.relationship_memory)
        hall = state.world_state.location_occupancy.setdefault("town_hall", [])
        for agent_id in agents:
            if agent_id not in hall:
                hall.append(agent_id)

    def _conversation_events(
        self, phase: PhaseName, outcome: ConversationOutcome
    ) -> list[RoundEvent]:
        events: list[RoundEvent] = []
        for turn in outcome.turns:
            events.append(
                RoundEvent(
                    phase=phase,
                    summary=turn.content,
                    data={
                        "kind": "agent_speak",
                        "speaker_id": turn.speaker_id,
                        "speaker_name": turn.speaker_name,
                        "listener_id": turn.listener_id,
                        "listener_name": turn.listener_name,
                        "tone": turn.tone,
                        "location": outcome.location,
                        "trust_delta": turn.trust_delta,
                    },
                )
            )
        events.append(
            RoundEvent(
                phase=phase,
                summary=outcome.summary,
                data={
                    "kind": "conversation_summary",
                    "location": outcome.location,
                    "participants": outcome.participants,
                },
            )
        )
        return events

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
                    "self_sacrifice",
                }:
                    cooperative += 1
        if total == 0:
            return 0.5
        return round(cooperative / total, 2)

    def _active_agents(self, state: SimulationState) -> list[EngineAgentState]:
        return [
            agent
            for agent in state.agents
            if agent.status not in {AgentStatus.EXILED, AgentStatus.DEAD}
        ]

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

    def _prepare_action(
        self, state: SimulationState, agent: EngineAgentState, turn: AgentTurnResult
    ) -> PreparedAction:
        current_tile = self._agent_tile(agent)
        requested_action = turn.decision.action.type
        requested_location = turn.decision.action.location

        if requested_location:
            goals = resolve_location_target(requested_location)
            if not goals:
                return self._block_action(
                    agent,
                    turn=turn,
                    round_number=state.world_state.round_number,
                    requested_action=requested_action,
                    note=f"{agent.name} cannot find a valid route to {requested_location} and pauses to observe.",
                )

            path = step_toward(
                current_tile,
                goals,
                max_steps=self.MAX_MOVE_TILES_PER_ACTION,
            )
            destination = path[-1]
            self._set_agent_tile(agent, destination)
            if requested_action == "move":
                reached = destination in goals
                summary = (
                    f"{agent.name} moves to {agent.location}."
                    if reached
                    else f"{agent.name} moves toward {requested_location} but cannot reach it this turn."
                )
                return PreparedAction(
                    agent=agent,
                    turn=turn,
                    action_type="move",
                    location=agent.location or "town_square",
                    summary=summary,
                )

            if destination not in goals:
                return PreparedAction(
                    agent=agent,
                    turn=turn,
                    action_type="move",
                    location=agent.location or "town_square",
                    summary=(
                        f"{agent.name} heads toward {requested_location} and spends the turn traveling."
                    ),
                )

        location = agent.location or location_label_for_tile(self._agent_tile(agent))
        location_type = get_location_type(location)
        allowed_location_types = self.ACTION_LOCATION_RULES.get(requested_action)
        if (
            allowed_location_types is not None
            and location_type not in allowed_location_types
        ):
            allowed = ", ".join(sorted(allowed_location_types))
            return self._block_action(
                agent,
                turn=turn,
                round_number=state.world_state.round_number,
                requested_action=requested_action,
                note=(
                    f"{agent.name} cannot {requested_action} effectively at {location}; "
                    f"that action requires one of: {allowed}."
                ),
            )

        if requested_action in self.AGENT_INTERACTION_ACTIONS:
            interaction_range = (
                self.RANGED_CONTACT_RANGE_TILES
                if requested_action in self.RANGED_ACTIONS
                else self.CONTACT_RANGE_TILES
            )
            if not self._has_nearby_agent(state, agent, max_distance=interaction_range):
                return self._block_action(
                    agent,
                    turn=turn,
                    round_number=state.world_state.round_number,
                    requested_action=requested_action,
                    note=(
                        f"{agent.name} cannot {requested_action} from {location}; "
                        "no other agent is close enough."
                    ),
                )

        return PreparedAction(
            agent=agent,
            turn=turn,
            action_type=requested_action,
            location=location,
        )

    def _block_action(
        self,
        agent: EngineAgentState,
        *,
        turn: AgentTurnResult,
        round_number: int,
        requested_action: str,
        note: str,
    ) -> PreparedAction:
        agent.suspicion_level, _ = apply_suspicion_trigger(
            current_level=agent.suspicion_level,
            trigger="failed_action",
            note=note,
        )
        agent.memory = append_recent_event(
            agent.memory,
            MemoryEvent(
                round_number=round_number,
                summary=note,
                emotional_charge=6,
                tags=["failed_action", requested_action],
            ),
        )
        return PreparedAction(
            agent=agent,
            turn=turn,
            action_type="observe",
            location=agent.location or "town_square",
            summary=note,
        )

    def _has_nearby_agent(
        self, state: SimulationState, agent: EngineAgentState, *, max_distance: int
    ) -> bool:
        origin = self._agent_tile(agent)
        for other in self._active_agents(state):
            if other.agent_id == agent.agent_id:
                continue
            if tile_distance(origin, self._agent_tile(other)) <= max_distance:
                return True
        return False

    def _ensure_agent_position(self, agent: EngineAgentState) -> None:
        if agent.tile_x is None or agent.tile_y is None:
            tile_x, tile_y = resolve_spawn_tile(agent.location)
            agent.tile_x = tile_x
            agent.tile_y = tile_y
            agent.location = agent.location or location_label_for_tile((tile_x, tile_y))

    def _agent_tile(self, agent: EngineAgentState) -> tuple[int, int]:
        self._ensure_agent_position(agent)
        return cast(int, agent.tile_x), cast(int, agent.tile_y)

    def _set_agent_tile(self, agent: EngineAgentState, tile: tuple[int, int]) -> None:
        agent.tile_x, agent.tile_y = tile
        agent.location = location_label_for_tile(tile)

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
