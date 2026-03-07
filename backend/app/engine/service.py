from __future__ import annotations

from datetime import UTC, datetime
from random import Random
from typing import cast

from app.agents.service import AgentService
from app.engine.models import (
    ConflictRecord,
    ConversationOutcome,
    EngineAgentState,
    FactionState,
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
from app.social import SocialService
from app.world.models import ResourceName, ResourceTick
from app.world.service import apply_resource_tick, calculate_threat_level


class SimulationEngine:
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
        self._refresh_factions(state)

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
        self._update_experiment_status(state)
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
            experiment_id=state.experiment_id,
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
        outcome = self.social_service.run_meeting(state, proposal=proposal)
        self._apply_meeting_relationships(state, outcome)
        faction_events = self._faction_events(state)
        exile_events = self._apply_exile_outcome(state, outcome)

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
        for agent in state.agents:
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
        events.extend(exile_events)
        events.extend(faction_events)
        return PhaseResult(
            phase="midday",
            events=events,
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
        for agent in self._active_agents(state):
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
            if action_type == "talk" and len(group) > 1:
                outcomes = self.social_service.run_conversations(
                    state,
                    location=location,
                    participants=[agent for agent, _ in group],
                )
                self._apply_conversation_outcomes(state, outcomes)
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
        if any(agent.suspicion_level >= 70 for agent in self._active_agents(state)):
            return "Hold an exile vote before the panic spreads any further"
        if state.world_state.threat_level > 50:
            return "Emergency rationing until the next dawn"
        if state.gm_plan and state.gm_plan.plan.crisis_event.type in {"social", "discovery"}:
            return "Investigate whoever is spreading lies"
        return "Share watch duty at the fence tonight"

    def _apply_conversation_outcomes(
        self, state: SimulationState, outcomes: list[ConversationOutcome]
    ) -> None:
        agents = {agent.agent_id: agent for agent in state.agents}
        for outcome in outcomes:
            for turn in outcome.turns:
                speaker = agents[turn.speaker_id]
                listener = agents[turn.listener_id]
                speaker.memory = self.agent_service.register_observation(
                    speaker.memory,
                    round_number=state.world_state.round_number,
                    summary=turn.content,
                    emotional_charge=8,
                )
                listener.memory = self.agent_service.register_observation(
                    listener.memory,
                    round_number=state.world_state.round_number,
                    summary=turn.content,
                    emotional_charge=6,
                )
                speaker.memory = self.agent_service.update_relationship(
                    speaker.memory,
                    other_agent_id=listener.agent_id,
                    trust_delta=turn.trust_delta,
                    note=turn.content,
                )
                speaker.relationships = dict(speaker.memory.relationship_memory)
                occupancy = state.world_state.location_occupancy.setdefault(outcome.location, [])
                for participant_id in outcome.participants:
                    if participant_id not in occupancy:
                        occupancy.append(participant_id)
        if outcomes:
            self._refresh_factions(state)

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
        self._refresh_factions(state)

    def _apply_exile_outcome(self, state: SimulationState, outcome: MeetingOutcome) -> list[RoundEvent]:
        if outcome.exile is None:
            return []

        events = [
            RoundEvent(
                phase="midday",
                summary=(
                    f"The room calls for a vote on exiling "
                    f"{outcome.exile.target_agent_name or 'an unnamed suspect'}."
                ),
                data={"kind": "exile_vote", **outcome.exile.model_dump(mode="json")},
            )
        ]
        if not outcome.exile.enacted or outcome.exile.target_agent_id is None:
            return events

        for agent in state.agents:
            if agent.agent_id != outcome.exile.target_agent_id:
                continue
            agent.status = "exiled"
            agent.location = "perimeter_fence"
            agent.faction_id = None
            agent.faction_role = None
            break

        state.exile_history.append(outcome.exile)
        state.exile_history = state.exile_history[-12:]
        self._refresh_factions(state)
        events.append(
            RoundEvent(
                phase="midday",
                summary=f"{outcome.exile.target_agent_name} is exiled by the town.",
                data={"kind": "exile_enacted", **outcome.exile.model_dump(mode="json")},
            )
        )
        return events

    def _faction_events(self, state: SimulationState) -> list[RoundEvent]:
        events: list[RoundEvent] = []
        for faction in state.factions:
            kind = "cult_activity" if faction.kind == "cult" else "faction_update"
            summary = (
                f"{faction.name} consolidates around {len(faction.member_ids)} members."
                if faction.kind == "alliance"
                else f"{faction.name} spreads its doctrine through {len(faction.member_ids)} adherents."
            )
            events.append(
                RoundEvent(
                    phase="midday",
                    summary=summary,
                    data={
                        "kind": kind,
                        "faction": faction.model_dump(mode="json"),
                        "faction_kind": faction.kind,
                    },
                )
            )
        return events

    def _refresh_factions(self, state: SimulationState) -> None:
        active_agents = self._active_agents(state)
        assigned: set[str] = set()
        factions: list[FactionState] = []

        for leader in sorted(active_agents, key=self._influence_score, reverse=True):
            if leader.agent_id in assigned:
                continue
            if not self._is_cult_candidate(leader):
                continue
            members = [
                agent.agent_id
                for agent in active_agents
                if agent.agent_id not in assigned
                and self._supports_leader(agent, leader)
            ]
            if len(members) < 2:
                continue
            faction = FactionState(
                faction_id=f"cult:{leader.agent_id}",
                name=f"{leader.name}'s Circle",
                kind="cult",
                leader_id=leader.agent_id,
                member_ids=members,
                doctrine=leader.goal.text,
                influence=min(100.0, round(sum(self._influence_score(agent) for agent in active_agents if agent.agent_id in members) / len(members), 2)),
                formed_round=state.world_state.round_number,
                pressure=min(100.0, round(leader.suspicion_level + len(members) * 6, 2)),
            )
            factions.append(faction)
            assigned.update(members)

        remaining = [agent for agent in active_agents if agent.agent_id not in assigned]
        seen_components: set[str] = set()
        for agent in remaining:
            if agent.agent_id in seen_components:
                continue
            component = self._alliance_component(agent, remaining)
            seen_components.update(member.agent_id for member in component)
            if len(component) < 2:
                continue
            leader = max(component, key=self._influence_score)
            member_ids = [member.agent_id for member in component]
            influence = min(
                100.0,
                round(sum(self._influence_score(member) for member in component) / len(component), 2),
            )
            factions.append(
                FactionState(
                    faction_id=f"alliance:{leader.agent_id}",
                    name=f"{leader.name}'s Bloc",
                    kind="alliance",
                    leader_id=leader.agent_id,
                    member_ids=member_ids,
                    doctrine=None,
                    influence=influence,
                    formed_round=state.world_state.round_number,
                    pressure=min(100.0, round(influence + len(component) * 4, 2)),
                )
            )

        state.factions = factions
        for agent in state.agents:
            agent.faction_id = None
            agent.faction_role = None
            agent.influence = round(self._influence_score(agent), 2)
        faction_map = {
            member_id: faction for faction in factions for member_id in faction.member_ids
        }
        for agent in state.agents:
            faction = faction_map.get(agent.agent_id)
            if faction is None:
                continue
            agent.faction_id = faction.faction_id
            agent.faction_role = "leader" if agent.agent_id == faction.leader_id else "member"

    def _is_cult_candidate(self, agent: EngineAgentState) -> bool:
        return agent.goal.archetype == "belief_transformation" or "devout" in agent.personality.trait_tags

    def _supports_leader(self, agent: EngineAgentState, leader: EngineAgentState) -> bool:
        if agent.agent_id == leader.agent_id:
            return True
        trust = agent.relationships.get(leader.agent_id)
        return (
            (trust is not None and trust.trust >= -2)
            or agent.goal.archetype == "belief_transformation"
            or "devout" in agent.personality.trait_tags
        )

    def _alliance_component(
        self, seed: EngineAgentState, candidates: list[EngineAgentState]
    ) -> list[EngineAgentState]:
        agents = {agent.agent_id: agent for agent in candidates}
        stack = [seed.agent_id]
        visited: set[str] = set()
        component: list[EngineAgentState] = []
        while stack:
            current_id = stack.pop()
            if current_id in visited:
                continue
            visited.add(current_id)
            current = agents[current_id]
            component.append(current)
            for other in candidates:
                if other.agent_id in visited or other.agent_id == current_id:
                    continue
                if self._allied(current, other):
                    stack.append(other.agent_id)
        return component

    def _allied(self, left: EngineAgentState, right: EngineAgentState) -> bool:
        left_trust = left.relationships.get(right.agent_id)
        right_trust = right.relationships.get(left.agent_id)
        if left.goal.archetype == right.goal.archetype:
            return True
        return (
            (left_trust is not None and left_trust.trust >= 1.0)
            or (right_trust is not None and right_trust.trust >= 1.0)
        )

    def _influence_score(self, agent: EngineAgentState) -> float:
        return min(
            100.0,
            (agent.personality.axes.dominance * 0.4)
            + (agent.personality.axes.loyalty * 0.15)
            + (agent.personality.axes.ambition * 0.2)
            + max(agent.suspicion_level, 20.0) * 0.25,
        )

    def _active_agents(self, state: SimulationState) -> list[EngineAgentState]:
        return [agent for agent in state.agents if agent.status != "exiled"]

    def _update_experiment_status(self, state: SimulationState) -> None:
        if state.world_state.threat_level >= 100:
            state.status = "collapsed"
        elif state.current_round >= state.total_rounds:
            state.status = "completed"

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
                    "pray",
                    "rally",
                    "mourn",
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
