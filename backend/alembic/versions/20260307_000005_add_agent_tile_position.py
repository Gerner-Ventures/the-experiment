"""add agent tile position

Revision ID: 20260307_000005
Revises: 20260307_000004
Create Date: 2026-03-07 19:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260307_000005"
down_revision: Union[str, None] = "20260307_000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("tile_x", sa.Integer(), nullable=True))
    op.add_column("agents", sa.Column("tile_y", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("agents", "tile_y")
    op.drop_column("agents", "tile_x")
