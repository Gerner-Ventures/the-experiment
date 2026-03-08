"""fix enum values to lowercase

The main Neon DB has uppercase enum values (SETUP, RUNNING, etc.) but the
SQLAlchemy models define lowercase values (setup, running, etc.). This
migration renames any uppercase values to lowercase, with safe checks.

Revision ID: 20260308_000007
Revises: 20260307_000006
Create Date: 2026-03-08 00:00:00.000000
"""

import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

log = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = "20260308_000007"
down_revision: Union[str, None] = "20260307_000006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Enum name -> (uppercase_label, lowercase_label)
# Note: f-string SQL is used because ALTER TYPE ... RENAME VALUE does not support
# bind parameters. All values are compile-time constants from ENUM_FIXES below.
ENUM_FIXES: dict[str, list[tuple[str, str]]] = {
    "experiment_status": [
        ("SETUP", "setup"),
        ("RUNNING", "running"),
        ("PAUSED", "paused"),
        ("COMPLETED", "completed"),
        ("COLLAPSED", "collapsed"),
    ],
    "agent_status": [
        ("IDLE", "idle"),
        ("THINKING", "thinking"),
        ("TALKING", "talking"),
        ("MOVING", "moving"),
        ("WORKING", "working"),
        ("SNEAKING", "sneaking"),
        ("EXILED", "exiled"),
    ],
    "resource_pressure": [
        ("LOW", "low"),
        ("MEDIUM", "medium"),
        ("HIGH", "high"),
        ("CRITICAL", "critical"),
    ],
    "event_type": [
        ("ROUND", "round"),
        ("ACTION", "action"),
        ("SOCIAL", "social"),
        ("CRISIS", "crisis"),
        ("SYSTEM", "system"),
    ],
}


def _has_enum_value(conn, enum_name: str, value: str) -> bool:
    result = conn.execute(
        text(
            "SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid "
            "WHERE t.typname = :enum_name AND e.enumlabel = :value"
        ),
        {"enum_name": enum_name, "value": value},
    )
    return result.scalar() is not None


def upgrade() -> None:
    conn = op.get_bind()
    for enum_name, mappings in ENUM_FIXES.items():
        for old_val, new_val in mappings:
            if _has_enum_value(conn, enum_name, old_val) and not _has_enum_value(
                conn, enum_name, new_val
            ):
                log.info("Renaming %s value '%s' -> '%s'", enum_name, old_val, new_val)
                op.execute(f"ALTER TYPE \"{enum_name}\" RENAME VALUE '{old_val}' TO '{new_val}'")
            else:
                log.info("Skipping %s value '%s' (already correct)", enum_name, old_val)


def downgrade() -> None:
    conn = op.get_bind()
    for enum_name, mappings in ENUM_FIXES.items():
        for old_val, new_val in mappings:
            if _has_enum_value(conn, enum_name, new_val) and not _has_enum_value(
                conn, enum_name, old_val
            ):
                log.info("Renaming %s value '%s' -> '%s'", enum_name, new_val, old_val)
                op.execute(f"ALTER TYPE \"{enum_name}\" RENAME VALUE '{new_val}' TO '{old_val}'")
