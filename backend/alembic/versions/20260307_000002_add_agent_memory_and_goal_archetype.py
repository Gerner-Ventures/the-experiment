"""add agent memory and goal archetype

Revision ID: 20260307_000002
Revises: 20260306_000001
Create Date: 2026-03-07 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260307_000002"
down_revision: Union[str, None] = "20260306_000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("character_id", sa.String(length=255), nullable=True))
    op.add_column("agents", sa.Column("goal_archetype", sa.String(length=100), nullable=True))
    op.add_column(
        "agents",
        sa.Column("memory", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.alter_column("agents", "memory", server_default=None)


def downgrade() -> None:
    op.drop_column("agents", "memory")
    op.drop_column("agents", "goal_archetype")
    op.drop_column("agents", "character_id")
