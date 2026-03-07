from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ExperimentStatus(str, enum.Enum):
    SETUP = "setup"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    COLLAPSED = "collapsed"


class AgentStatus(str, enum.Enum):
    IDLE = "idle"
    THINKING = "thinking"
    TALKING = "talking"
    MOVING = "moving"
    WORKING = "working"
    SNEAKING = "sneaking"
    EXILED = "exiled"


class ResourcePressure(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class EventType(str, enum.Enum):
    ROUND = "round"
    ACTION = "action"
    SOCIAL = "social"
    CRISIS = "crisis"
    SYSTEM = "system"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Experiment(TimestampMixin, Base):
    __tablename__ = "experiments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[ExperimentStatus] = mapped_column(
        Enum(ExperimentStatus, name="experiment_status"),
        default=ExperimentStatus.SETUP,
        nullable=False,
    )
    auto_approve: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    current_round: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_rounds: Mapped[int] = mapped_column(Integer, nullable=False)
    threat_level: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    resources: Mapped[dict[str, float]] = mapped_column(JSON, nullable=False, default=dict)
    world_state: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    unresolved_plotlines: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    recent_events: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    arc: Mapped[Arc | None] = relationship(
        back_populates="experiment",
        cascade="all, delete-orphan",
        uselist=False,
    )
    agents: Mapped[list[Agent]] = relationship(
        back_populates="experiment", cascade="all, delete-orphan"
    )
    rounds: Mapped[list[Round]] = relationship(
        back_populates="experiment", cascade="all, delete-orphan"
    )
    events: Mapped[list[Event]] = relationship(
        back_populates="experiment", cascade="all, delete-orphan"
    )
    world_snapshots: Mapped[list[WorldSnapshot]] = relationship(
        back_populates="experiment",
        cascade="all, delete-orphan",
    )
    gm_plans: Mapped[list[GMPlan]] = relationship(
        back_populates="experiment", cascade="all, delete-orphan"
    )


class Arc(TimestampMixin, Base):
    __tablename__ = "arcs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("experiments.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    experiment: Mapped[Experiment] = relationship(back_populates="arc")
    acts: Mapped[list[Act]] = relationship(
        back_populates="arc",
        cascade="all, delete-orphan",
        order_by="Act.start_round",
    )


class Act(TimestampMixin, Base):
    __tablename__ = "acts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    arc_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("arcs.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    start_round: Mapped[int] = mapped_column(Integer, nullable=False)
    end_round: Mapped[int] = mapped_column(Integer, nullable=False)
    tone: Mapped[str] = mapped_column(String(255), nullable=False)
    gm_instructions: Mapped[str] = mapped_column(Text, nullable=False)
    resource_pressure: Mapped[ResourcePressure] = mapped_column(
        Enum(ResourcePressure, name="resource_pressure"),
        nullable=False,
    )
    director_notes: Mapped[str | None] = mapped_column(Text)

    arc: Mapped[Arc] = relationship(back_populates="acts")


class Agent(TimestampMixin, Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("experiments.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    character_id: Mapped[str | None] = mapped_column(String(255))
    personality: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    goal: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    goal_archetype: Mapped[str | None] = mapped_column(String(100))
    secret_goal: Mapped[str] = mapped_column(Text, nullable=False)
    llm_model: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[AgentStatus] = mapped_column(
        Enum(AgentStatus, name="agent_status"),
        default=AgentStatus.IDLE,
        nullable=False,
    )
    suspicion_level: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    inventory: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    memory: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    relationships: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    experiment: Mapped[Experiment] = relationship(back_populates="agents")


class Round(TimestampMixin, Base):
    __tablename__ = "rounds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("experiments.id", ondelete="CASCADE"),
        nullable=False,
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    phase: Mapped[str] = mapped_column(String(100), nullable=False, default="planning")
    summary: Mapped[str | None] = mapped_column(Text)

    experiment: Mapped[Experiment] = relationship(back_populates="rounds")


class Event(TimestampMixin, Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("experiments.id", ondelete="CASCADE"),
        nullable=False,
    )
    round_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("rounds.id", ondelete="SET NULL"),
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agents.id", ondelete="SET NULL"),
    )
    type: Mapped[EventType] = mapped_column(Enum(EventType, name="event_type"), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    experiment: Mapped[Experiment] = relationship(back_populates="events")


class WorldSnapshot(TimestampMixin, Base):
    __tablename__ = "world_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("experiments.id", ondelete="CASCADE"),
        nullable=False,
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    experiment: Mapped[Experiment] = relationship(back_populates="world_snapshots")


class GMPlan(TimestampMixin, Base):
    __tablename__ = "gm_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("experiments.id", ondelete="CASCADE"),
        nullable=False,
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    round_theme: Mapped[str] = mapped_column(String(255), nullable=False)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    crisis_event: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    resource_modifiers: Mapped[dict[str, float]] = mapped_column(JSON, nullable=False, default=dict)
    environmental: Mapped[str | None] = mapped_column(Text)
    narration: Mapped[str] = mapped_column(Text, nullable=False)
    meta_hint: Mapped[str | None] = mapped_column(Text)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    experiment: Mapped[Experiment] = relationship(back_populates="gm_plans")
