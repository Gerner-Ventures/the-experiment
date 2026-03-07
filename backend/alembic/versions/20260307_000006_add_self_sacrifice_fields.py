"""add self-sacrifice fields

Revision ID: 20260307_000006
Revises: 20260307_000005
Create Date: 2026-03-07 20:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260307_000006"
down_revision: Union[str, None] = "20260307_000005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE agent_status ADD VALUE IF NOT EXISTS 'dead'")

    op.add_column(
        "experiments",
        sa.Column(
            "sacrifice_history",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )
    op.alter_column("experiments", "sacrifice_history", server_default=None)

    op.add_column("agents", sa.Column("death_round", sa.Integer(), nullable=True))
    op.add_column("agents", sa.Column("death_cause", sa.String(length=100), nullable=True))


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed in place, so the added `dead` value remains
    # on `agent_status` after downgrade unless the enum type is recreated.
    op.drop_column("agents", "death_cause")
    op.drop_column("agents", "death_round")
    op.drop_column("experiments", "sacrifice_history")
