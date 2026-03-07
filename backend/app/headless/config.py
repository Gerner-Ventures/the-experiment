from __future__ import annotations

import json
from pathlib import Path

from app.api.models import CreateExperimentRequest

HEADLESS_DIR = Path(__file__).resolve().parent
DEFAULT_SCENARIO_PATH = HEADLESS_DIR / "data" / "default_scenario.json"


def load_experiment_request(
    config_path: str | Path | None,
    *,
    rounds: int | None = None,
) -> tuple[CreateExperimentRequest, Path]:
    source_path = (
        DEFAULT_SCENARIO_PATH if config_path is None else Path(config_path).expanduser().resolve()
    )
    payload = json.loads(source_path.read_text())
    request = CreateExperimentRequest.model_validate(payload)
    if rounds is not None:
        request = request.model_copy(update={"total_rounds": rounds})
    return request, source_path
