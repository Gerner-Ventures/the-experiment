from __future__ import annotations

import json
from pathlib import Path
from typing import Generator

import pytest

from app.core.config import get_settings
from app.headless.factory import PROVIDER_ENV_VARS, _required_live_providers
from app.headless.cli import main, run_headless_experiment


@pytest.fixture(autouse=True)
def reset_settings_cache() -> Generator[None, None, None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _report_signature(report: object) -> tuple[object, ...]:
    from app.headless.models import HeadlessRunReport

    headless_report = (
        report
        if isinstance(report, HeadlessRunReport)
        else HeadlessRunReport.model_validate(report)
    )
    rounds = []
    for round_summary in headless_report.rounds:
        rounds.append(
            (
                round_summary.round_number,
                tuple(
                    (
                        action.agent_name,
                        action.action_index,
                        action.action_type,
                        action.location,
                    )
                    for action in round_summary.agent_actions
                ),
                round(round_summary.threat_level, 2),
            )
        )
    return tuple(rounds)


def test_cli_smoke_writes_json_report(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    output_path = tmp_path / "headless-report.json"

    exit_code = main(["--rounds", "2", "--seed", "11", "--json-out", str(output_path)])

    assert exit_code == 0
    stdout = capsys.readouterr().out
    assert "Round 1:" in stdout
    assert "Final:" in stdout
    assert output_path.exists()

    payload = json.loads(output_path.read_text())
    assert payload["metadata"]["mode"] == "mock"
    assert len(payload["rounds"]) == 2
    assert payload["validations"]


@pytest.mark.asyncio
async def test_headless_mock_mode_is_deterministic_by_seed() -> None:
    report_a = await run_headless_experiment(mode="mock", seed=17, rounds=2)
    report_b = await run_headless_experiment(mode="mock", seed=17, rounds=2)
    report_c = await run_headless_experiment(mode="mock", seed=18, rounds=2)

    assert _report_signature(report_a) == _report_signature(report_b)
    assert _report_signature(report_a) != _report_signature(report_c)


def test_live_mode_validation_fails_fast(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("app.headless.factory.sync_provider_credentials_to_env", lambda: None)
    for env_var in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(env_var, raising=False)
    get_settings.cache_clear()

    exit_code = main(["--mode", "live", "--rounds", "1"])

    assert exit_code == 1
    stderr = capsys.readouterr().err
    assert "Live mode requires configured provider credentials" in stderr
    for provider in sorted(_required_live_providers()):
        assert PROVIDER_ENV_VARS[provider] in stderr
