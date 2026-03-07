from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def _script_directory() -> ScriptDirectory:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    return ScriptDirectory.from_config(config)


def test_alembic_has_a_single_head_revision() -> None:
    script = _script_directory()

    heads = script.get_heads()

    assert len(heads) == 1


def test_alembic_revision_ids_are_unique() -> None:
    script = _script_directory()

    revisions = [revision.revision for revision in script.walk_revisions()]

    assert len(revisions) == len(set(revisions))
