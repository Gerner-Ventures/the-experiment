"""add runtime persistence fields

Revision ID: 20260307_000003
Revises: 20260307_000002
Create Date: 2026-03-07 13:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260307_000003"
down_revision: Union[str, None] = "20260307_000002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "experiments",
        sa.Column("auto_approve", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "experiments",
        sa.Column("world_state", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.add_column(
        "experiments",
        sa.Column(
            "unresolved_plotlines",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )
    op.add_column(
        "experiments",
        sa.Column("recent_events", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
    )
    op.alter_column("experiments", "auto_approve", server_default=None)
    op.alter_column("experiments", "world_state", server_default=None)
    op.alter_column("experiments", "unresolved_plotlines", server_default=None)
    op.alter_column("experiments", "recent_events", server_default=None)

    op.add_column("agents", sa.Column("character_id", sa.String(length=255), nullable=True))
    op.add_column(
        "agents",
        sa.Column("goal", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.alter_column("agents", "goal", server_default=None)

    op.add_column(
        "gm_plans",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
    )
    op.add_column("gm_plans", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("gm_plans", sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("gm_plans", "status", server_default=None)


def downgrade() -> None:
    op.drop_column("gm_plans", "applied_at")
    op.drop_column("gm_plans", "approved_at")
    op.drop_column("gm_plans", "status")
    op.drop_column("agents", "goal")
    op.drop_column("agents", "character_id")
    op.drop_column("experiments", "recent_events")
    op.drop_column("experiments", "unresolved_plotlines")
    op.drop_column("experiments", "world_state")
    op.drop_column("experiments", "auto_approve")
