from __future__ import annotations

import asyncio
from dataclasses import dataclass

import structlog
from datetime import UTC, datetime
from random import Random
from typing import Literal, cast

from app.agents.memory import append_recent_event
from app.agents.models import (
    AgentMemoryState,
    AgentTurnResult,
    ConsequenceActionType,
    MemoryEvent,
)
from app.agents.suspicion import apply_suspicion_trigger
from app.agents.service import AgentService
from app.core import langfuse as lf
from app.db.models import AgentStatus
from app.engine.models import (
    ActionResolution,
    ActionResolutionOutcome,
    ConflictRecord,
    ConversationOutcome,
    EngineAgentState,
    FactionState,
    MeetingOutcome,
    NullHook,
    PhaseName,
    PhaseResult,
    RoundEvent,
    RoundHook,
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

log = structlog.get_logger(__name__)


@dataclass
class PreparedAction:
    agent: EngineAgentState
    turn: AgentTurnResult
    action_type: str
    location: str
    summary: str | None = None


class SimulationEngine:
    MAX_MOVE_TILES_PER_ACTION = 2
    CONTACT_RANGE_TILES = 2
    RANGED_CONTACT_RANGE_TILES = 4
    SELF_SACRIFICE_THREAT_DELTA = -8.0
    SELF_SACRIFICE_RESOURCE_EFFECTS = {"food": 1.0, "materials": 0.8}
    SELF_SACRIFICE_SUSPICION_DELTA = 9.0
    AGENT_INTERACTION_ACTIONS = {
        "talk",
        "trade",
        "accuse",
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
    ACTION_CONSEQUENCE_TYPES: dict[str, tuple[ConsequenceActionType, ...]] = {
        "shoot": ("bleeding", "injured"),
        "stab": ("bleeding", "injured"),
        "attack": ("injured", "knocked_down", "stunned", "burning"),
        "poison": ("poisoned",),
        "threaten": ("crying", "fleeing", "stunned"),
    }
    CONSEQUENCE_SUSPICION_DELTAS: dict[ConsequenceActionType, float] = {
        "bleeding": 8.0,
        "injured": 7.0,
        "stunned": 6.0,
        "knocked_down": 7.0,
        "burning": 9.0,
        "poisoned": 8.0,
        "crying": 4.0,
        "fleeing": 5.0,
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

    @staticmethod
    def _obj_id(obj: object) -> str:
        return getattr(obj, "id", None) or ""

    @staticmethod
    def _set_phase_context(trace: object, span: object) -> None:
        trace_id = SimulationEngine._obj_id(trace)
        span_id = SimulationEngine._obj_id(span)
        if trace_id:
            lf.set_trace_context(trace_id=trace_id, span_id=span_id)

    async def run_round(
        self, state: SimulationState, *, hook: RoundHook | None = None
    ) -> RoundResult:
        h = hook or NullHook()
        round_number = state.current_round + 1
        state.world_state.round_number = round_number
        self._refresh_factions(state)

        log.info(
            "round_started",
            experiment_id=state.experiment_id,
            round_number=round_number,
            total_rounds=state.total_rounds,
            agent_count=len(state.agents),
        )

        trace = lf.trace(
            name=f"round-{round_number}",
            session_id=state.experiment_id or None,
            input={
                "round": round_number,
                "arc": state.arc.name,
                # TODO: include current act name (spec Req 7)
                "resources": state.world_state.resources.model_dump(),
                "threat_level": state.world_state.threat_level,
                "agent_count": len(state.agents),
            },
            tags=[
                f"arc:{state.arc.name}",
            ],
            metadata={
                "experiment_id": state.experiment_id,
                "round_number": round_number,
                "total_rounds": state.total_rounds,
                "status": state.status,
            },
        )

        # --- GM Plan phase ---
        if (
            state.gm_plan
            and state.gm_plan.plan.round == round_number
            and state.gm_plan.status == "applied"
        ):
            gm_plan = state.gm_plan
            lf.span(name="gm_plan", parent=trace, metadata={"pre_approved": True})
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
            gm_span = lf.span(name="gm_plan", parent=trace)
            self._set_phase_context(trace, gm_span)
            gm_result, gm_plan = await self._gm_plan_phase(state, round_number)
        await h.on_round_start(round_number, gm_plan)
        await h.on_phase_start(round_number, "gm_plan")
        await h.on_phase_complete(round_number, gm_result)

        # --- Dawn phase ---
        await h.on_phase_start(round_number, "dawn")
        dawn_span = lf.span(name="dawn", parent=trace)
        self._set_phase_context(trace, dawn_span)
        dawn_result = self._dawn_phase(state, gm_plan.plan)
        await h.on_phase_complete(round_number, dawn_result)

        # --- Morning actions ---
        await h.on_phase_start(round_number, "morning")
        morning_span = lf.span(name="morning", parent=trace)
        self._set_phase_context(trace, morning_span)
        morning_result, morning_turns, morning_actions = await self._action_phase(
            state,
            phase="morning",
            actions_per_agent=2,
            hook=h,
            trace=trace,
            phase_span=morning_span,
        )
        await h.on_phase_complete(round_number, morning_result)

        # --- Midday (town meeting) ---
        await h.on_phase_start(round_number, "midday")
        midday_result = self._midday_phase(state)
        await h.on_phase_complete(round_number, midday_result)

        # --- Afternoon actions ---
        await h.on_phase_start(round_number, "afternoon")
        afternoon_span = lf.span(name="afternoon", parent=trace)
        self._set_phase_context(trace, afternoon_span)
        afternoon_result, afternoon_turns, afternoon_actions = await self._action_phase(
            state,
            phase="afternoon",
            actions_per_agent=1,
            hook=h,
            trace=trace,
            phase_span=afternoon_span,
        )
        await h.on_phase_complete(round_number, afternoon_result)

        # --- Night phase ---
        await h.on_phase_start(round_number, "night")
        cooperation_ratio = self._calculate_cooperation_ratio(
            [*morning_turns.values(), *afternoon_turns.values()]
        )
        night_span = lf.span(name="night", parent=trace)
        self._set_phase_context(trace, night_span)
        night_result = await self._night_phase(
            state,
            cooperation_ratio,
            trace=trace,
            night_span=night_span,
        )
        await h.on_phase_complete(round_number, night_result)

        # --- Finalize state ---
        state.current_round = round_number
        state.world_state.threat_level = (
            night_result.cooperation_ratio or state.world_state.threat_level
        )
        self._update_experiment_status(state)
        log.info(
            "round_phases_complete",
            experiment_id=state.experiment_id,
            round_number=round_number,
            status=state.status,
            threat_level=state.world_state.threat_level,
            cooperation_ratio=round(cooperation_ratio, 3),
        )
        if trace is not None:
            try:
                trace.update(
                    output={
                        "status": state.status,
                        "cooperation_ratio": round(cooperation_ratio, 3),
                        "threat_level": round(state.world_state.threat_level, 2),
                        "event_count": sum(
                            len(pr.events)
                            for pr in [
                                gm_result,
                                dawn_result,
                                morning_result,
                                midday_result,
                                afternoon_result,
                                night_result,
                            ]
                        ),
                    },
                    metadata={"status": state.status},
                )
            except Exception:
                log.warning("langfuse trace.update failed", exc_info=True)

            trace_id = self._obj_id(trace)
            if trace_id:
                lf.record_scores(
                    trace_id=trace_id,
                    scores={
                        "cooperation_ratio": round(cooperation_ratio, 3),
                        "threat_level": round(state.world_state.threat_level, 2),
                        # TODO: add total_cost_usd and llm_call_count scores (spec Req 5)
                    },
                )
        state.recent_events.extend(
            event.summary
            for phase_result in [
                gm_result,
                dawn_result,
                morning_result,
                midday_result,
                afternoon_result,
                night_result,
            ]
            for event in phase_result.events
        )
        state.recent_events = state.recent_events[-20:]
        state.gm_plan = gm_plan
        agent_turns: dict[str, list[AgentTurnResult]] = {}
        for agent_id in set(morning_turns) | set(afternoon_turns):
            agent_turns[agent_id] = [
                *morning_turns.get(agent_id, []),
                *afternoon_turns.get(agent_id, []),
            ]

        lf.reset_trace_context()
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
            agent_turns=agent_turns,
            action_resolutions=[*morning_actions, *afternoon_actions],
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
        phase: Literal["morning", "afternoon"],
        actions_per_agent: int,
        hook: RoundHook | None = None,
        trace: object = None,
        phase_span: object = None,
    ) -> tuple[PhaseResult, dict[str, list[AgentTurnResult]], list[ActionResolution]]:
        all_turns: dict[str, list[AgentTurnResult]] = {}
        actions: list[PreparedAction] = []
        for agent in self._active_agents(state):
            self._ensure_agent_position(agent)
        # Actions are prepared sequentially, not from a start-of-phase position snapshot.
        # If one agent moves first, later proximity checks in the same phase will see that
        # updated tile position.
        for agent in self._active_agents(state):
            agent_span = lf.span(
                name=f"agent:{agent.name}",
                parent=phase_span or trace,
                metadata={"agent_id": agent.agent_id, "agent_name": agent.name},
            )
            if agent_span:
                lf.set_trace_context(
                    trace_id=self._obj_id(trace),
                    span_id=self._obj_id(agent_span),
                )
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
                if hook:
                    await hook.on_agent_action(state.world_state.round_number, phase, agent, turn)
                if prepared.action_type == "self_sacrifice":
                    break
            all_turns[agent.agent_id] = turns

        result, action_resolutions = await self._resolve_actions(
            state, phase=phase, actions=actions
        )
        return result, all_turns, action_resolutions

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
        events.extend(exile_events)
        events.extend(faction_events)
        return PhaseResult(
            phase="midday",
            events=events,
        )

    async def _night_phase(
        self,
        state: SimulationState,
        cooperation_ratio: float,
        trace: object = None,
        night_span: object = None,
    ) -> PhaseResult:
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
                    trace=trace,
                    night_span=night_span,
                    experiment_id=state.experiment_id,
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
        trace: object = None,
        night_span: object = None,
        experiment_id: str | None = None,
    ) -> tuple[str, AgentMemoryState]:
        memory_span = lf.span(
            name=f"memory:{agent.name}",
            parent=night_span or trace,
            metadata={"agent_id": agent.agent_id, "agent_name": agent.name},
        )
        if memory_span:
            lf.set_trace_context(
                trace_id=self._obj_id(trace),
                span_id=self._obj_id(memory_span),
            )
        reflection = f"{agent.name} ends the night feeling {self._night_mood(agent.suspicion_level, cooperation_ratio)}."
        updated_memory = await self.agent_service.register_observation(
            agent.memory,
            round_number=round_number,
            summary=reflection,
            emotional_charge=10,
            important=agent.suspicion_level > 40,
            goal=agent.goal,
            suspicion_level=agent.suspicion_level,
            classify=False,
            experiment_id=experiment_id,
            agent_id=agent.agent_id,
            agent_name=agent.name,
        )
        updated_memory = await self.agent_service.consolidate_memory(
            updated_memory,
            goal=agent.goal,
            suspicion_level=agent.suspicion_level,
            experiment_id=experiment_id,
            agent_id=agent.agent_id,
            agent_name=agent.name,
        )
        updated_memory = await self.agent_service.consolidate_relationship_memory(
            updated_memory,
            goal=agent.goal,
            suspicion_level=agent.suspicion_level,
            experiment_id=experiment_id,
            agent_id=agent.agent_id,
            agent_name=agent.name,
            round_number=round_number,
        )
        return reflection, updated_memory

    async def _resolve_actions(
        self,
        state: SimulationState,
        *,
        phase: Literal["morning", "afternoon"],
        actions: list[PreparedAction],
    ) -> tuple[PhaseResult, list[ActionResolution]]:
        grouped: dict[tuple[str, str], list[PreparedAction]] = {}
        events: list[RoundEvent] = []
        conflicts: list[ConflictRecord] = []
        action_resolutions: list[ActionResolution] = []
        faction_refresh_needed = False

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
                for prepared in group:
                    action_resolutions.append(
                        self._action_resolution(
                            phase=phase,
                            prepared=prepared,
                            resolved_action_type="talk",
                            summary=(
                                prepared.summary
                                or f"{prepared.agent.name} joins a tense conversation at {location}."
                            ),
                            outcome="resolved",
                        )
                    )
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
                events.append(
                    RoundEvent(
                        phase=phase,
                        summary=summary,
                        data={
                            "kind": "action_conflict",
                            "location": location,
                            "action_type": action_type,
                            "participants": [prepared.agent.agent_id for prepared in group],
                            "winner_ids": [prepared.agent.agent_id for prepared in winners],
                            "loser_ids": [prepared.agent.agent_id for prepared in losers],
                        },
                    )
                )
                for prepared in winners:
                    action_resolutions.append(
                        self._action_resolution(
                            phase=phase,
                            prepared=prepared,
                            resolved_action_type=action_type,
                            summary=f"{prepared.agent.name} wins the clash over {action_type} at {location}.",
                            outcome="conflict_winner",
                        )
                    )
                for prepared in losers:
                    action_resolutions.append(
                        self._action_resolution(
                            phase=phase,
                            prepared=prepared,
                            resolved_action_type="observe",
                            summary=(
                                f"{prepared.agent.name} loses the clash over {action_type} at "
                                f"{location} and falls back."
                            ),
                            outcome="conflict_loser",
                        )
                    )
            else:
                for prepared in group:
                    agent = prepared.agent
                    turn = prepared.turn
                    resolved_target = self._resolve_target_agent(state, prepared)
                    sacrifice = None
                    if prepared.action_type == "self_sacrifice":
                        sacrifice = self._apply_self_sacrifice(state, agent, location)
                        faction_refresh_needed = True
                    else:
                        self._apply_clean_action(state, agent, prepared.action_type, location)
                    summary = (
                        sacrifice.reason
                        if sacrifice is not None
                        else prepared.summary
                        or f"{agent.name} chose to {prepared.action_type} at {location}."
                    )
                    events.append(
                        RoundEvent(
                            phase=phase,
                            summary=summary,
                            data={
                                "kind": "agent_action",
                                "agent_id": agent.agent_id,
                                "agent_name": agent.name,
                                "location": location,
                                "action_type": prepared.action_type,
                                "requested_action_type": turn.decision.action.type,
                                "action": turn.decision.action.model_dump(mode="json"),
                                "is_consequence": False,
                                **(
                                    {
                                        "target_agent_id": resolved_target.agent_id,
                                        "target_agent_name": resolved_target.name,
                                    }
                                    if resolved_target is not None
                                    else {}
                                ),
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
                    if turn.decision.dialogue and turn.decision.dialogue.message.strip():
                        events.append(
                            RoundEvent(
                                phase=phase,
                                summary=turn.decision.dialogue.message,
                                data={
                                    "kind": "agent_speak",
                                    "agent_id": agent.agent_id,
                                    "agent_name": agent.name,
                                    "target": turn.decision.dialogue.target or "all",
                                    "message": turn.decision.dialogue.message,
                                },
                            )
                        )
                    action_resolutions.append(
                        self._action_resolution(
                            phase=phase,
                            prepared=prepared,
                            resolved_action_type=prepared.action_type,
                            summary=summary,
                            outcome=self._action_outcome(prepared),
                            resolved_target=resolved_target,
                        )
                    )
                    consequence = self._build_consequence_result(
                        state,
                        phase=phase,
                        prepared=prepared,
                        target=resolved_target,
                        location=location,
                    )
                    if consequence is not None:
                        event, resolution = consequence
                        events.append(event)
                        action_resolutions.append(resolution)

        if faction_refresh_needed:
            self._refresh_factions(state)

        return PhaseResult(phase=phase, events=events, conflicts=conflicts), action_resolutions

    def _action_resolution(
        self,
        *,
        phase: Literal["morning", "afternoon"],
        prepared: PreparedAction,
        resolved_action_type: str,
        summary: str,
        outcome: ActionResolutionOutcome,
        resolved_target: EngineAgentState | None = None,
    ) -> ActionResolution:
        dialogue_target = (
            prepared.turn.decision.dialogue.target if prepared.turn.decision.dialogue else None
        )
        return ActionResolution(
            phase=phase,
            agent_id=prepared.agent.agent_id,
            agent_name=prepared.agent.name,
            location=prepared.location,
            requested_action_type=prepared.turn.decision.action.type,
            resolved_action_type=resolved_action_type,
            outcome=outcome,
            cooperation_intent=prepared.turn.decision.cooperation_intent,
            goal_progress=prepared.turn.decision.goal_progress,
            summary=summary,
            target=(
                resolved_target.agent_id
                if resolved_target is not None
                else prepared.turn.decision.action.target
            ),
            dialogue_target=dialogue_target,
            suspicion_level=prepared.agent.suspicion_level,
        )

    def _action_outcome(self, prepared: PreparedAction) -> ActionResolutionOutcome:
        requested_action = prepared.turn.decision.action.type
        if prepared.action_type == "self_sacrifice":
            return "self_sacrifice"
        if requested_action == prepared.action_type:
            return "resolved"
        if prepared.action_type == "observe":
            return "blocked"
        if prepared.action_type == "move":
            return "rerouted"
        return "resolved"

    def _apply_clean_action(
        self, state: SimulationState, agent: EngineAgentState, action_type: str, location: str
    ) -> None:
        occupancy = state.world_state.location_occupancy.setdefault(location, [])
        if agent.agent_id not in occupancy:
            occupancy.append(agent.agent_id)
        self._apply_resource_effect(state, action_type)

    def _build_consequence_result(
        self,
        state: SimulationState,
        *,
        phase: Literal["morning", "afternoon"],
        prepared: PreparedAction,
        target: EngineAgentState | None,
        location: str,
    ) -> tuple[RoundEvent, ActionResolution] | None:
        options = self.ACTION_CONSEQUENCE_TYPES.get(prepared.action_type)
        if not options or target is None:
            return None
        consequence_type = self.random.choice(options)
        consequence_location = target.location or location
        summary = self._consequence_summary(
            source=prepared.agent,
            target=target,
            source_action_type=prepared.action_type,
            consequence_type=consequence_type,
            location=consequence_location,
        )
        self._record_consequence_on_target(
            state,
            target=target,
            consequence_type=consequence_type,
            source=prepared.agent,
            source_action_type=prepared.action_type,
            summary=summary,
        )
        return (
            RoundEvent(
                phase=phase,
                summary=summary,
                data={
                    "kind": "agent_action",
                    "agent_id": target.agent_id,
                    "agent_name": target.name,
                    "location": consequence_location,
                    "action_type": consequence_type,
                    "requested_action_type": consequence_type,
                    "resolved_action_type": consequence_type,
                    "action": {
                        "type": consequence_type,
                        "target": prepared.agent.agent_id,
                        "location": consequence_location,
                    },
                    "is_consequence": True,
                    "source_agent_id": prepared.agent.agent_id,
                    "source_agent_name": prepared.agent.name,
                    "source_action_type": prepared.action_type,
                },
            ),
            ActionResolution(
                phase=phase,
                agent_id=target.agent_id,
                agent_name=target.name,
                location=consequence_location,
                requested_action_type=consequence_type,
                resolved_action_type=consequence_type,
                cooperation_intent="none",
                goal_progress=(
                    f"System consequence from {prepared.agent.name}'s {prepared.action_type}."
                ),
                summary=summary,
                target=prepared.agent.agent_id,
                suspicion_level=target.suspicion_level,
                is_consequence=True,
                source_agent_id=prepared.agent.agent_id,
                source_agent_name=prepared.agent.name,
                source_action_type=prepared.action_type,
            ),
        )

    def _record_consequence_on_target(
        self,
        state: SimulationState,
        *,
        target: EngineAgentState,
        consequence_type: ConsequenceActionType,
        source: EngineAgentState,
        source_action_type: str,
        summary: str,
    ) -> None:
        target.suspicion_level = min(
            100.0,
            target.suspicion_level + self.CONSEQUENCE_SUSPICION_DELTAS.get(consequence_type, 5.0),
        )
        target.memory = append_recent_event(
            target.memory,
            MemoryEvent(
                round_number=state.world_state.round_number,
                summary=summary,
                emotional_charge=18
                if consequence_type in {"bleeding", "injured", "poisoned"}
                else 12,
                tags=["consequence", consequence_type, source_action_type, source.agent_id],
            ),
        )

    def _consequence_summary(
        self,
        *,
        source: EngineAgentState,
        target: EngineAgentState,
        source_action_type: str,
        consequence_type: ConsequenceActionType,
        location: str,
    ) -> str:
        action_phrase = {
            "shoot": "shoots",
            "stab": "stabs",
            "attack": "attacks",
            "poison": "poisons",
            "threaten": "threatens",
        }.get(source_action_type, f"uses {source_action_type} on")
        consequence_text: dict[ConsequenceActionType, str] = {
            "bleeding": (
                f"{target.name} is left bleeding after {source.name} {action_phrase} them at {location}."
            ),
            "injured": (
                f"{target.name} is injured after {source.name} {action_phrase} them at {location}."
            ),
            "stunned": (
                f"{target.name} is stunned after {source.name} {action_phrase} them at {location}."
            ),
            "knocked_down": (
                f"{target.name} is knocked down after {source.name} {action_phrase} them at {location}."
            ),
            "burning": (
                f"{target.name} is burning after {source.name} {action_phrase} them at {location}."
            ),
            "poisoned": (
                f"{target.name} is poisoned after {source.name} {action_phrase} them at {location}."
            ),
            "crying": (
                f"{target.name} breaks down crying after {source.name} {action_phrase} them at {location}."
            ),
            "fleeing": f"{target.name} flees after {source.name} {action_phrase} them at {location}.",
        }
        return consequence_text[consequence_type]

    def _resolve_target_agent(
        self,
        state: SimulationState,
        prepared: PreparedAction,
    ) -> EngineAgentState | None:
        if prepared.action_type not in self.AGENT_INTERACTION_ACTIONS:
            return None
        origin = self._agent_tile(prepared.agent)
        nearby_agents = [
            other
            for other in self._active_agents(state)
            if other.agent_id != prepared.agent.agent_id
            and tile_distance(
                origin,
                self._agent_tile(other),
            )
            <= self._interaction_range(prepared.action_type)
        ]
        if not nearby_agents:
            return None
        requested_target = prepared.turn.decision.action.target
        if prepared.action_type in self.ACTION_CONSEQUENCE_TYPES and not requested_target:
            return None
        if isinstance(requested_target, str) and requested_target:
            requested_target_normalized = requested_target.casefold()
            for other in nearby_agents:
                if (
                    other.agent_id == requested_target
                    or other.name.casefold() == requested_target_normalized
                ):
                    return other
        return min(
            nearby_agents,
            key=lambda other: (tile_distance(origin, self._agent_tile(other)), other.name),
        )

    def _interaction_range(self, action_type: str) -> int:
        return (
            self.RANGED_CONTACT_RANGE_TILES
            if action_type in self.RANGED_ACTIONS
            else self.CONTACT_RANGE_TILES
        )

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
        self._remove_agent_from_occupancy(state, agent.agent_id)

        # This is modeled as a town-wide shock event, not a strict proximity-based witness system.
        affected_agent_ids: list[str] = []
        for witness in self._active_agents(state):
            affected_agent_ids.append(witness.agent_id)
            witness.suspicion_level = min(
                100.0,
                round(witness.suspicion_level + self.SELF_SACRIFICE_SUSPICION_DELTA, 2),
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
            action_type="self_sacrifice",
            reason=(
                f"{agent.name} performs a ritual self-sacrifice at {location}, "
                "shocking the town into temporary order."
            ),
            threat_delta=self.SELF_SACRIFICE_THREAT_DELTA,
            resource_effects=dict(self.SELF_SACRIFICE_RESOURCE_EFFECTS),
            affected_agent_ids=affected_agent_ids,
        )
        state.sacrifice_history.append(outcome)
        state.sacrifice_history = state.sacrifice_history[-12:]
        return outcome

    def _meeting_proposal(self, state: SimulationState) -> str:
        if any(agent.suspicion_level >= 70 for agent in self._active_agents(state)):
            return "Hold an exile vote before the panic spreads any further"
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

    def _apply_exile_outcome(
        self, state: SimulationState, outcome: MeetingOutcome
    ) -> list[RoundEvent]:
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
            agent.status = AgentStatus.EXILED
            agent.location = "perimeter_fence"
            agent.faction_id = None
            agent.faction_role = None
            self._remove_agent_from_occupancy(state, agent.agent_id)
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
                if agent.agent_id not in assigned and self._supports_leader(agent, leader)
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
                influence=min(
                    100.0,
                    round(
                        sum(
                            self._influence_score(agent)
                            for agent in active_agents
                            if agent.agent_id in members
                        )
                        / len(members),
                        2,
                    ),
                ),
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
                round(
                    sum(self._influence_score(member) for member in component) / len(component), 2
                ),
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
            if agent.status in {AgentStatus.EXILED, AgentStatus.DEAD}:
                agent.influence = 0.0
                continue
            agent.influence = round(self._influence_score(agent), 2)
        faction_map = {
            member_id: faction for faction in factions for member_id in faction.member_ids
        }
        for agent in state.agents:
            agent_faction = faction_map.get(agent.agent_id)
            if agent_faction is None:
                continue
            agent.faction_id = agent_faction.faction_id
            agent.faction_role = "leader" if agent.agent_id == agent_faction.leader_id else "member"

    def _is_cult_candidate(self, agent: EngineAgentState) -> bool:
        return (
            agent.goal.archetype == "belief_transformation"
            or "devout" in agent.personality.trait_tags
        )

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
        return (left_trust is not None and left_trust.trust >= 1.0) or (
            right_trust is not None and right_trust.trust >= 1.0
        )

    def _influence_score(self, agent: EngineAgentState) -> float:
        return min(
            100.0,
            (agent.personality.axes.dominance * 0.4)
            + (agent.personality.axes.loyalty * 0.15)
            + (agent.personality.axes.ambition * 0.2)
            + max(agent.suspicion_level, 20.0) * 0.25,
        )

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
                        "agent_id": turn.speaker_id,
                        "agent_name": turn.speaker_name,
                        "message": turn.content,
                        "target": turn.listener_name or "all",
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
        action_tile = current_tile
        action_location = agent.location or location_label_for_tile(current_tile)

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
            destination_location = location_label_for_tile(destination)
            if requested_action == "move":
                self._set_agent_tile(agent, destination)
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
                self._set_agent_tile(agent, destination)
                return PreparedAction(
                    agent=agent,
                    turn=turn,
                    action_type="move",
                    location=agent.location or "town_square",
                    summary=(
                        f"{agent.name} heads toward {requested_location} and spends the turn traveling."
                    ),
                )
            action_tile = destination
            action_location = destination_location

        location_type = get_location_type(action_location)
        allowed_location_types = self.ACTION_LOCATION_RULES.get(requested_action)
        if allowed_location_types is not None and location_type not in allowed_location_types:
            allowed = ", ".join(sorted(allowed_location_types))
            return self._block_action(
                agent,
                turn=turn,
                round_number=state.world_state.round_number,
                requested_action=requested_action,
                note=(
                    f"{agent.name} cannot {requested_action} effectively at {action_location}; "
                    f"that action requires one of: {allowed}."
                ),
            )

        if requested_action in self.AGENT_INTERACTION_ACTIONS:
            interaction_range = (
                self.RANGED_CONTACT_RANGE_TILES
                if requested_action in self.RANGED_ACTIONS
                else self.CONTACT_RANGE_TILES
            )
            if not self._has_nearby_agent(
                state, agent, max_distance=interaction_range, origin_tile=action_tile
            ):
                return self._block_action(
                    agent,
                    turn=turn,
                    round_number=state.world_state.round_number,
                    requested_action=requested_action,
                    note=(
                        f"{agent.name} cannot {requested_action} from {action_location}; "
                        "no other agent is close enough."
                    ),
                )

        if action_tile != current_tile:
            self._set_agent_tile(agent, action_tile)

        return PreparedAction(
            agent=agent,
            turn=turn,
            action_type=requested_action,
            location=action_location,
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
        # Blocked actions immediately affect memory/suspicion so subsequent decisions in the
        # same round can react to the failed attempt.
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
        self,
        state: SimulationState,
        agent: EngineAgentState,
        *,
        max_distance: int,
        origin_tile: tuple[int, int] | None = None,
    ) -> bool:
        origin = origin_tile or self._agent_tile(agent)
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

    def _remove_agent_from_occupancy(self, state: SimulationState, agent_id: str) -> None:
        for occupants in state.world_state.location_occupancy.values():
            while agent_id in occupants:
                occupants.remove(agent_id)

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
