from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Sequence

from pydantic import ValidationError

from app.headless.config import load_experiment_request
from app.headless.factory import build_headless_runtime
from app.headless.models import HeadlessMode, HeadlessRunReport
from app.headless.reporting import (
    build_headless_run_report,
    render_headless_report,
    write_json_report,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a backend experiment headlessly with an in-memory runtime."
    )
    parser.add_argument(
        "--config",
        type=str,
        help="Path to a CreateExperimentRequest JSON file.",
    )
    parser.add_argument(
        "--mode",
        choices=("mock", "live"),
        default="mock",
        help="Use seeded mock services or the live LLM-backed services.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=7,
        help="Deterministic seed used for mock-mode execution.",
    )
    parser.add_argument(
        "--rounds",
        type=int,
        default=None,
        help="Override the scenario round count before the run starts.",
    )
    parser.add_argument(
        "--json-out",
        type=str,
        default=None,
        help="Optional output path for the JSON report.",
    )
    return parser


async def run_headless_experiment(
    *,
    mode: HeadlessMode = "mock",
    seed: int = 7,
    config: str | Path | None = None,
    rounds: int | None = None,
) -> HeadlessRunReport:
    request, config_source = load_experiment_request(config, rounds=rounds)
    runtime = build_headless_runtime(mode=mode, seed=seed)
    started_at = datetime.now(UTC)
    state = await runtime.create_experiment(request)
    round_results = []

    while state.status not in {"collapsed", "completed"} and state.current_round < request.total_rounds:
        previous_round = state.current_round
        round_result, state = await runtime.step(state.experiment_id)
        if state.current_round <= previous_round:
            raise RuntimeError(
                "Headless run stalled because the experiment did not advance to the next round."
            )
        round_results.append(round_result)

    completed_at = datetime.now(UTC)
    return await build_headless_run_report(
        runtime,
        request=request,
        experiment_id=state.experiment_id,
        round_results=round_results,
        mode=mode,
        seed=seed,
        config_source=str(config_source),
        started_at=started_at,
        completed_at=completed_at,
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = asyncio.run(
            run_headless_experiment(
                mode=args.mode,
                seed=args.seed,
                config=args.config,
                rounds=args.rounds,
            )
        )
    except (FileNotFoundError, RuntimeError, ValueError, ValidationError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(render_headless_report(report))
    if args.json_out:
        output_path = write_json_report(report, args.json_out)
        print(f"JSON report written to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
