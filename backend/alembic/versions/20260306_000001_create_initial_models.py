"""create initial models

Revision ID: 20260306_000001
Revises:
Create Date: 2026-03-06 23:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260306_000001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


experiment_status = sa.Enum(
    "setup",
    "running",
    "paused",
    "completed",
    "collapsed",
    name="experiment_status",
    create_type=False,
)
agent_status = sa.Enum(
    "idle",
    "thinking",
    "talking",
    "moving",
    "working",
    "sneaking",
    "exiled",
    name="agent_status",
    create_type=False,
)
resource_pressure = sa.Enum(
    "low",
    "medium",
    "high",
    "critical",
    name="resource_pressure",
    create_type=False,
)
event_type = sa.Enum(
    "round",
    "action",
    "social",
    "crisis",
    "system",
    name="event_type",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    experiment_status.create(bind, checkfirst=True)
    agent_status.create(bind, checkfirst=True)
    resource_pressure.create(bind, checkfirst=True)
    event_type.create(bind, checkfirst=True)

    op.create_table(
        "experiments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", experiment_status, nullable=False),
        sa.Column("current_round", sa.Integer(), nullable=False),
        sa.Column("total_rounds", sa.Integer(), nullable=False),
        sa.Column("threat_level", sa.Float(), nullable=False),
        sa.Column("resources", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "arcs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("experiment_id"),
    )
    op.create_table(
        "acts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arc_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("start_round", sa.Integer(), nullable=False),
        sa.Column("end_round", sa.Integer(), nullable=False),
        sa.Column("tone", sa.String(length=255), nullable=False),
        sa.Column("gm_instructions", sa.Text(), nullable=False),
        sa.Column("resource_pressure", resource_pressure, nullable=False),
        sa.Column("director_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["arc_id"], ["arcs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "agents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("personality", sa.JSON(), nullable=False),
        sa.Column("secret_goal", sa.Text(), nullable=False),
        sa.Column("llm_model", sa.String(length=255), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("status", agent_status, nullable=False),
        sa.Column("suspicion_level", sa.Float(), nullable=False),
        sa.Column("inventory", sa.JSON(), nullable=False),
        sa.Column("relationships", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "rounds",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("phase", sa.String(length=100), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("round_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("type", event_type, nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["round_id"], ["rounds.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "world_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "gm_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("round_theme", sa.String(length=255), nullable=False),
        sa.Column("reasoning", sa.Text(), nullable=False),
        sa.Column("crisis_event", sa.JSON(), nullable=False),
        sa.Column("resource_modifiers", sa.JSON(), nullable=False),
        sa.Column("environmental", sa.Text(), nullable=True),
        sa.Column("narration", sa.Text(), nullable=False),
        sa.Column("meta_hint", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_rounds_experiment_round_number",
        "rounds",
        ["experiment_id", "round_number"],
        unique=False,
    )
    op.create_index(
        "ix_events_experiment_created_at", "events", ["experiment_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_world_snapshots_experiment_round_number",
        "world_snapshots",
        ["experiment_id", "round_number"],
        unique=False,
    )
    op.create_index(
        "ix_gm_plans_experiment_round_number",
        "gm_plans",
        ["experiment_id", "round_number"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_gm_plans_experiment_round_number", table_name="gm_plans")
    op.drop_index("ix_world_snapshots_experiment_round_number", table_name="world_snapshots")
    op.drop_index("ix_events_experiment_created_at", table_name="events")
    op.drop_index("ix_rounds_experiment_round_number", table_name="rounds")
    op.drop_table("gm_plans")
    op.drop_table("world_snapshots")
    op.drop_table("events")
    op.drop_table("rounds")
    op.drop_table("agents")
    op.drop_table("acts")
    op.drop_table("arcs")
    op.drop_table("experiments")

    bind = op.get_bind()
    event_type.drop(bind, checkfirst=True)
    resource_pressure.drop(bind, checkfirst=True)
    agent_status.drop(bind, checkfirst=True)
    experiment_status.drop(bind, checkfirst=True)
