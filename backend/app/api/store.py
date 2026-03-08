from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.models import EventLogItem, EventLogType
from app.db.models import (
    Arc,
    Act,
    Agent,
    Event,
    EventType,
    Experiment,
    ExperimentStatus,
    GMPlan,
    Round,
    WorldSnapshot,
)
from app.engine.models import (
    EngineAgentState,
    ExileOutcome,
    FactionState,
    RoundResult,
    SacrificeOutcome,
    SimulationState,
)
from app.gm.models import DirectorAct, DirectorArc, GMPlanRecord
from app.world import build_default_world_state
from app.world.models import ResourceState, WorldState


class ExperimentStore(Protocol):
    async def load_state(self, experiment_id: str) -> SimulationState: ...

    async def save_state(self, state: SimulationState) -> None: ...

    async def append_log(self, item: EventLogItem) -> None: ...

    async def list_logs(self, experiment_id: str) -> list[EventLogItem]: ...

    async def record_round_result(self, experiment_id: str, round_result: RoundResult) -> None: ...

    async def load_world_snapshot(
        self, experiment_id: str, round_number: int
    ) -> dict[str, object] | None: ...

    async def list_world_snapshots(
        self, experiment_id: str
    ) -> list[tuple[int, dict[str, object]]]: ...


class InMemoryExperimentStore:
    def __init__(self) -> None:
        self.states: dict[str, SimulationState] = {}
        self.logs: defaultdict[str, list[EventLogItem]] = defaultdict(list)
        self.snapshots: defaultdict[str, dict[int, dict[str, object]]] = defaultdict(dict)

    async def load_state(self, experiment_id: str) -> SimulationState:
        return self.states[experiment_id]

    async def save_state(self, state: SimulationState) -> None:
        self.states[state.experiment_id] = state.model_copy(deep=True)

    async def append_log(self, item: EventLogItem) -> None:
        self.logs[item.experiment_id].append(item)

    async def list_logs(self, experiment_id: str) -> list[EventLogItem]:
        return list(self.logs[experiment_id])

    async def record_round_result(self, experiment_id: str, round_result: RoundResult) -> None:
        self.snapshots[experiment_id][round_result.round_number] = (
            round_result.world_state.model_dump(mode="json")
        )

    async def load_world_snapshot(
        self, experiment_id: str, round_number: int
    ) -> dict[str, object] | None:
        return self.snapshots[experiment_id].get(round_number)

    async def list_world_snapshots(self, experiment_id: str) -> list[tuple[int, dict[str, object]]]:
        return sorted(self.snapshots[experiment_id].items())


class SqlAlchemyExperimentStore:
    def __init__(self, session_factory: Callable[[], AsyncSession]) -> None:
        self.session_factory = session_factory

    async def load_state(self, experiment_id: str) -> SimulationState:
        async with self.session_factory() as session:
            experiment = await self._load_experiment(session, experiment_id)
            if experiment is None:
                raise KeyError(experiment_id)
            return self._to_state(experiment)

    async def save_state(self, state: SimulationState) -> None:
        async with self.session_factory() as session:
            experiment = await self._load_experiment(session, state.experiment_id)
            if experiment is None:
                experiment = Experiment(
                    id=uuid.UUID(state.experiment_id), name=state.experiment_name
                )
                # Populate JSON/relationship fields before the row is added so the initial
                # INSERT persists the complete state in one flush.
                self._apply_state(experiment, state)
                session.add(experiment)
                await session.flush()
            else:
                self._apply_state(experiment, state)
            await session.commit()

    async def append_log(self, item: EventLogItem) -> None:
        async with self.session_factory() as session:
            event = Event(
                id=uuid.UUID(item.id),
                experiment_id=uuid.UUID(item.experiment_id),
                round_id=None,
                agent_id=uuid.UUID(item.agent_id) if item.agent_id else None,
                type=_event_category(item.type),
                payload=item.model_dump(mode="json"),
            )
            session.add(event)
            await session.commit()

    async def list_logs(self, experiment_id: str) -> list[EventLogItem]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(Event)
                .where(Event.experiment_id == uuid.UUID(experiment_id))
                .order_by(Event.created_at.asc())
            )
            items = []
            for event in result.scalars():
                items.append(EventLogItem.model_validate(event.payload))
            return items

    async def record_round_result(self, experiment_id: str, round_result: RoundResult) -> None:
        async with self.session_factory() as session:
            round_row = Round(
                experiment_id=uuid.UUID(experiment_id),
                round_number=round_result.round_number,
                phase="round_end",
                summary=round_result.phases[-1].events[-1].summary
                if round_result.phases and round_result.phases[-1].events
                else None,
            )
            session.add(round_row)
            snapshot = WorldSnapshot(
                experiment_id=uuid.UUID(experiment_id),
                round_number=round_result.round_number,
                state=round_result.world_state.model_dump(mode="json"),
            )
            session.add(snapshot)
            await session.commit()

    async def load_world_snapshot(
        self, experiment_id: str, round_number: int
    ) -> dict[str, object] | None:
        async with self.session_factory() as session:
            result = await session.execute(
                select(WorldSnapshot)
                .where(WorldSnapshot.experiment_id == uuid.UUID(experiment_id))
                .where(WorldSnapshot.round_number == round_number)
            )
            snapshot = result.scalar_one_or_none()
            return snapshot.state if snapshot is not None else None

    async def list_world_snapshots(self, experiment_id: str) -> list[tuple[int, dict[str, object]]]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(WorldSnapshot)
                .where(WorldSnapshot.experiment_id == uuid.UUID(experiment_id))
                .order_by(WorldSnapshot.round_number.asc())
            )
            return [(item.round_number, item.state) for item in result.scalars()]

    async def _load_experiment(
        self, session: AsyncSession, experiment_id: str
    ) -> Experiment | None:
        result = await session.execute(
            select(Experiment)
            .where(Experiment.id == uuid.UUID(experiment_id))
            .options(
                selectinload(Experiment.arc).selectinload(Arc.acts),
                selectinload(Experiment.agents),
                selectinload(Experiment.gm_plans),
            )
        )
        return result.scalar_one_or_none()

    def _apply_state(self, experiment: Experiment, state: SimulationState) -> None:
        experiment.name = state.experiment_name
        experiment.status = ExperimentStatus(state.status)
        experiment.auto_approve = state.auto_approve
        experiment.current_round = state.current_round
        experiment.total_rounds = state.total_rounds
        experiment.threat_level = state.world_state.threat_level
        experiment.resources = state.world_state.resources.model_dump(mode="json")
        experiment.world_state = state.world_state.model_dump(mode="json")
        experiment.unresolved_plotlines = list(state.unresolved_plotlines)
        experiment.recent_events = list(state.recent_events)
        experiment.factions = [faction.model_dump(mode="json") for faction in state.factions]
        experiment.exile_history = [
            record.model_dump(mode="json") for record in state.exile_history
        ]
        experiment.sacrifice_history = [
            record.model_dump(mode="json") for record in state.sacrifice_history
        ]

        if experiment.arc is None:
            experiment.arc = Arc(name=state.arc.name, description=state.arc.description)
        else:
            experiment.arc.name = state.arc.name
            experiment.arc.description = state.arc.description
        experiment.arc.acts = [
            Act(
                name=act.name,
                start_round=act.start_round,
                end_round=act.end_round,
                tone=act.tone,
                gm_instructions=act.gm_instructions,
                resource_pressure=act.resource_pressure,
                director_notes=act.director_notes,
            )
            for act in state.arc.acts
        ]

        existing_agents = {str(agent.id): agent for agent in experiment.agents}
        experiment.agents = [
            self._apply_agent(existing_agents.get(agent_state.agent_id), agent_state)
            for agent_state in state.agents
        ]

        if state.gm_plan is not None:
            plan_row = next(
                (
                    item
                    for item in experiment.gm_plans
                    if item.round_number == state.gm_plan.plan.round
                ),
                None,
            )
            if plan_row is None:
                plan_row = GMPlan(round_number=state.gm_plan.plan.round)
                experiment.gm_plans.append(plan_row)
            self._apply_gm_plan(plan_row, state.gm_plan)

    def _apply_agent(self, db_agent: Agent | None, agent_state: EngineAgentState) -> Agent:
        agent = db_agent or Agent(id=uuid.UUID(agent_state.agent_id))
        agent.name = agent_state.name
        agent.character_id = agent_state.character_id
        agent.personality = agent_state.personality.model_dump(mode="json")
        agent.goal = agent_state.goal.model_dump(mode="json")
        agent.goal_archetype = agent_state.goal.archetype
        agent.secret_goal = agent_state.goal.text
        agent.llm_model = agent_state.llm_model
        agent.location = agent_state.location
        agent.tile_x = agent_state.tile_x
        agent.tile_y = agent_state.tile_y
        agent.status = agent_state.status
        agent.suspicion_level = agent_state.suspicion_level
        agent.inventory = list(agent_state.inventory)
        agent.memory = agent_state.memory.model_dump(mode="json")
        agent.relationships = {
            key: value.model_dump(mode="json") for key, value in agent_state.relationships.items()
        }
        agent.faction_id = agent_state.faction_id
        agent.faction_role = agent_state.faction_role
        agent.influence = agent_state.influence
        agent.death_round = agent_state.death_round
        agent.death_cause = agent_state.death_cause
        return agent

    def _apply_gm_plan(self, row: GMPlan, plan: GMPlanRecord) -> None:
        row.status = plan.status
        row.round_theme = plan.plan.round_theme
        row.reasoning = plan.plan.reasoning
        row.crisis_event = plan.plan.crisis_event.model_dump(mode="json")
        row.resource_modifiers = plan.plan.resource_modifiers.model_dump(mode="json")
        row.environmental = plan.plan.environmental
        row.narration = plan.plan.narration
        row.meta_hint = plan.plan.meta_hint
        row.approved_at = plan.approved_at
        row.applied_at = plan.applied_at

    def _to_state(self, experiment: Experiment) -> SimulationState:
        if experiment.arc is None:
            raise KeyError(str(experiment.id))

        arc = DirectorArc(
            name=experiment.arc.name,
            description=experiment.arc.description or "",
            acts=[
                DirectorAct(
                    name=act.name,
                    start_round=act.start_round,
                    end_round=act.end_round,
                    tone=act.tone,
                    gm_instructions=act.gm_instructions,
                    resource_pressure=act.resource_pressure,
                    director_notes=act.director_notes,
                )
                for act in sorted(experiment.arc.acts, key=lambda item: item.start_round)
            ],
        )

        agents = [
            EngineAgentState.model_validate(
                {
                    "agent_id": str(agent.id),
                    "name": agent.name,
                    "character_id": agent.character_id,
                    "status": agent.status,
                    "personality": agent.personality,
                    "goal": agent.goal,
                    "memory": agent.memory,
                    "location": agent.location,
                    "inventory": agent.inventory,
                    "relationships": agent.relationships,
                    "suspicion_level": agent.suspicion_level,
                    "llm_model": agent.llm_model,
                    "faction_id": agent.faction_id,
                    "faction_role": agent.faction_role,
                    "influence": agent.influence,
                    "tile_x": agent.tile_x,
                    "tile_y": agent.tile_y,
                    "death_round": agent.death_round,
                    "death_cause": agent.death_cause,
                }
            )
            for agent in experiment.agents
        ]

        plan_row = max(experiment.gm_plans, key=lambda item: item.round_number, default=None)
        gm_plan = self._to_gm_plan_record(plan_row) if plan_row is not None else None

        world_state_payload = experiment.world_state or {}
        if not world_state_payload:
            fallback_state = build_default_world_state()
            fallback_state.round_number = experiment.current_round
            fallback_state.resources = ResourceState.model_validate(experiment.resources)
            fallback_state.threat_level = experiment.threat_level
            world_state_payload = fallback_state.model_dump(mode="json")

        return SimulationState(
            experiment_id=str(experiment.id),
            experiment_name=experiment.name,
            total_rounds=experiment.total_rounds,
            current_round=experiment.current_round,
            status=experiment.status.value,
            auto_approve=experiment.auto_approve,
            arc=arc,
            world_state=WorldState.model_validate(world_state_payload),
            agents=agents,
            unresolved_plotlines=list(experiment.unresolved_plotlines),
            recent_events=list(experiment.recent_events),
            gm_plan=gm_plan,
            factions=[FactionState.model_validate(item) for item in experiment.factions],
            exile_history=[ExileOutcome.model_validate(item) for item in experiment.exile_history],
            sacrifice_history=[
                SacrificeOutcome.model_validate(item) for item in experiment.sacrifice_history
            ],
        )

    def _to_gm_plan_record(self, row: GMPlan) -> GMPlanRecord:
        return GMPlanRecord.model_validate(
            {
                "status": row.status,
                "approved_at": row.approved_at,
                "applied_at": row.applied_at,
                "plan": {
                    "round": row.round_number,
                    "round_theme": row.round_theme,
                    "reasoning": row.reasoning,
                    "crisis_event": row.crisis_event,
                    "resource_modifiers": row.resource_modifiers,
                    "environmental": row.environmental,
                    "narration": row.narration,
                    "meta_hint": row.meta_hint,
                },
            }
        )


def _event_category(event_type: EventLogType) -> EventType:
    if event_type in {"gm_plan", "dawn", "crisis_event", "resource_update", "threat_update"}:
        return EventType.CRISIS
    if event_type in {"agent_action", "agent_move", "experiment_started", "experiment_paused"}:
        return EventType.ACTION
    if event_type in {
        "midday",
        "observer_event",
        "faction_update",
        "cult_activity",
        "exile_vote",
        "exile_enacted",
    }:
        return EventType.SOCIAL
    if event_type in {"morning", "afternoon", "night", "round_start", "round_end"}:
        return EventType.ROUND
    return EventType.SYSTEM
