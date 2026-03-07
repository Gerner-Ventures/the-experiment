"""add runtime social and terminal fields

Revision ID: 20260307_000004
Revises: 20260307_000003
Create Date: 2026-03-07 16:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260307_000004"
down_revision: Union[str, None] = "20260307_000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "experiments",
        sa.Column("factions", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
    )
    op.add_column(
        "experiments",
        sa.Column("exile_history", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
    )
    op.alter_column("experiments", "factions", server_default=None)
    op.alter_column("experiments", "exile_history", server_default=None)

    op.add_column("agents", sa.Column("faction_id", sa.String(length=255), nullable=True))
    op.add_column("agents", sa.Column("faction_role", sa.String(length=32), nullable=True))
    op.add_column(
        "agents",
        sa.Column("influence", sa.Float(), nullable=False, server_default=sa.text("0")),
    )
    op.alter_column("agents", "influence", server_default=None)


def downgrade() -> None:
    op.drop_column("agents", "influence")
    op.drop_column("agents", "faction_role")
    op.drop_column("agents", "faction_id")
    op.drop_column("experiments", "exile_history")
    op.drop_column("experiments", "factions")
