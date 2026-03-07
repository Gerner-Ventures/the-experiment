from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from pathlib import Path

from app.api.models import CreateExperimentRequest
from app.api.models import EventLogItem
from app.api.runtime import ExperimentRuntime
from app.engine import RoundResult, SimulationState
from app.headless.models import (
    AgentActionSummary,
    HeadlessMode,
    HeadlessRunMetadata,
    HeadlessRunReport,
    RoundSummary,
    ValidationResult,
)

COOPERATIVE_ACTIONS = {
    "gather",
    "repair",
    "talk",
    "trade",
    "rest",
    "observe",
    "pray",
    "rally",
    "mourn",
}
REQUIRED_PHASES = {"gm_plan", "dawn", "morning", "midday", "afternoon", "night"}


async def build_headless_run_report(
    runtime: ExperimentRuntime,
    *,
    request: CreateExperimentRequest,
    experiment_id: str,
    round_results: list[RoundResult],
    mode: HeadlessMode,
    seed: int,
    config_source: str,
    started_at: datetime,
    completed_at: datetime,
) -> HeadlessRunReport:
    final_state = await runtime.get_state(experiment_id)
    analytics_summary = await runtime.get_analytics_summary(experiment_id)
    highlights = await runtime.get_highlights(experiment_id)
    logs = await runtime.store.list_logs(experiment_id)
    snapshots = await runtime.store.list_world_snapshots(experiment_id)
    return HeadlessRunReport(
        metadata=HeadlessRunMetadata(
            mode=mode,
            seed=seed,
            config_source=config_source,
            started_at=started_at,
            completed_at=completed_at,
            duration_seconds=round((completed_at - started_at).total_seconds(), 3),
        ),
        request=request,
        final_state=final_state,
        analytics_summary=analytics_summary,
        highlights=highlights,
        validations=_build_validations(
            final_state=final_state,
            round_results=round_results,
            logs=logs,
            snapshots=snapshots,
            analytics_cooperation_score=analytics_summary.cooperation_score,
        ),
        rounds=[_build_round_summary(round_result, final_state) for round_result in round_results],
    )


def render_headless_report(report: HeadlessRunReport) -> str:
    lines = [
        f"Headless Simulation: {report.request.name}",
        (
            f"Mode: {report.metadata.mode} | Seed: {report.metadata.seed} | "
            f"Config: {report.metadata.config_source}"
        ),
        "",
    ]
    for round_summary in report.rounds:
        lines.extend(
            [
                f"Round {round_summary.round_number}: {round_summary.theme}",
                f"  Crisis: {round_summary.crisis}",
                (
                    f"  Cooperation={round_summary.cooperation_ratio:.2f} | "
                    f"Threat={round_summary.threat_level:.2f} | "
                    f"Resources={_format_resources(round_summary.resources)}"
                ),
            ]
        )
        if round_summary.notable_events:
            lines.append(f"  Notable: {'; '.join(round_summary.notable_events)}")
        if round_summary.agent_actions:
            lines.append(f"  Actions: {_render_agent_actions(round_summary.agent_actions)}")
        lines.append("")

    passed_validations = sum(1 for validation in report.validations if validation.passed)
    lines.extend(
        [
            (
                f"Final: status={report.final_state.status} | "
                f"rounds={report.final_state.current_round}/{report.final_state.total_rounds} | "
                f"threat={report.analytics_summary.threat_level:.2f} | "
                f"resources={_format_resources(report.analytics_summary.current_resources)}"
            ),
            (
                "Highlights: "
                + (
                    "; ".join(item.summary for item in report.highlights[:3])
                    if report.highlights
                    else "none"
                )
            ),
            f"Validations: {passed_validations}/{len(report.validations)} passed",
        ]
    )
    for validation in report.validations:
        status = "PASS" if validation.passed else "FAIL"
        lines.append(f"  {status} {validation.key}: {validation.detail}")
    return "\n".join(lines).strip()


def write_json_report(report: HeadlessRunReport, output_path: str | Path) -> Path:
    path = Path(output_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(report.model_dump_json(indent=2))
    return path


def _build_round_summary(round_result: RoundResult, final_state: SimulationState) -> RoundSummary:
    agent_names = {agent.agent_id: agent.name for agent in final_state.agents}
    return RoundSummary(
        round_number=round_result.round_number,
        theme=round_result.gm_plan.plan.round_theme,
        crisis=round_result.gm_plan.plan.crisis_event.description,
        cooperation_ratio=round_result.cooperation_ratio,
        threat_level=round_result.threat_level,
        resources=round_result.world_state.resources.model_dump(mode="json"),
        notable_events=_round_notable_events(round_result),
        agent_actions=_round_agent_actions(round_result, agent_names),
    )


def _round_notable_events(round_result: RoundResult) -> list[str]:
    notable: list[str] = []
    interesting_kinds = {
        "conversation_summary",
        "cult_activity",
        "exile_enacted",
        "faction_update",
        "meeting_result",
        "self_sacrifice",
    }
    for phase in round_result.phases:
        for event in phase.events:
            kind = str(event.data.get("kind", ""))
            if phase.phase == "dawn" or kind in interesting_kinds:
                if event.summary not in notable:
                    notable.append(event.summary)
    return notable[:4]


def _round_agent_actions(
    round_result: RoundResult,
    agent_names: dict[str, str],
) -> list[AgentActionSummary]:
    actions: list[AgentActionSummary] = []
    ordered_agent_ids = sorted(
        round_result.agent_turns,
        key=lambda agent_id: (agent_names.get(agent_id, agent_id), agent_id),
    )
    for agent_id in ordered_agent_ids:
        turns = round_result.agent_turns[agent_id]
        for index, turn in enumerate(turns, start=1):
            actions.append(
                AgentActionSummary(
                    agent_id=agent_id,
                    agent_name=agent_names.get(agent_id, agent_id),
                    action_index=index,
                    action_type=turn.decision.action.type,
                    location=turn.decision.action.location,
                    cooperation_intent=turn.decision.cooperation_intent,
                    goal_progress=turn.decision.goal_progress,
                )
            )
    return actions


def _build_validations(
    *,
    final_state: SimulationState,
    round_results: list[RoundResult],
    logs: list[EventLogItem],
    snapshots: list[tuple[int, dict[str, object]]],
    analytics_cooperation_score: float,
) -> list[ValidationResult]:
    completed_rounds = len(round_results)
    phase_counts = [
        f"r{result.round_number}={len({phase.phase for phase in result.phases})}"
        for result in round_results
    ]
    crisis_count = sum(1 for item in logs if item.type == "crisis_event")
    round_end_count = sum(1 for item in logs if item.type == "round_end")
    agent_action_count = sum(1 for item in logs if item.type == "agent_action")
    cooperation_from_logs = _cooperation_from_logs(logs)
    return [
        ValidationResult(
            key="round_progression",
            passed=(
                final_state.current_round == completed_rounds
                and final_state.current_round <= final_state.total_rounds
            ),
            detail=(
                f"current_round={final_state.current_round}, "
                f"completed_rounds={completed_rounds}, total_rounds={final_state.total_rounds}"
            ),
        ),
        ValidationResult(
            key="phase_coverage",
            passed=all(
                {phase.phase for phase in result.phases} == REQUIRED_PHASES
                for result in round_results
            ),
            detail=", ".join(phase_counts) if phase_counts else "no rounds executed",
        ),
        ValidationResult(
            key="snapshot_count",
            passed=len(snapshots) == completed_rounds,
            detail=f"snapshots={len(snapshots)}, completed_rounds={completed_rounds}",
        ),
        ValidationResult(
            key="resource_bounds",
            passed=all(value >= 0 for value in final_state.world_state.resources.model_dump().values()),
            detail=_format_resources(final_state.world_state.resources.model_dump(mode="json")),
        ),
        ValidationResult(
            key="threat_bounds",
            passed=0 <= final_state.world_state.threat_level <= 100,
            detail=f"threat_level={final_state.world_state.threat_level:.2f}",
        ),
        ValidationResult(
            key="derived_log_coverage",
            passed=(
                crisis_count == completed_rounds
                and round_end_count == completed_rounds
                and (agent_action_count > 0 or not final_state.agents)
            ),
            detail=(
                f"crisis_event={crisis_count}, round_end={round_end_count}, "
                f"agent_action={agent_action_count}"
            ),
        ),
        ValidationResult(
            key="cooperation_consistency",
            passed=abs(cooperation_from_logs - analytics_cooperation_score) < 1e-9,
            detail=(
                f"from_logs={cooperation_from_logs:.2f}, "
                f"analytics={analytics_cooperation_score:.2f}"
            ),
        ),
    ]


def _cooperation_from_logs(logs: list[EventLogItem]) -> float:
    agent_actions = [
        item
        for item in logs
        if item.type == "agent_action" and isinstance(item.data.get("action"), dict)
    ]
    if not agent_actions:
        return 0.0
    cooperative_count = sum(
        1
        for item in agent_actions
        if str(item.data["action"].get("type")) in COOPERATIVE_ACTIONS
    )
    return round(cooperative_count / len(agent_actions), 2)


def _render_agent_actions(actions: list[AgentActionSummary]) -> str:
    grouped: defaultdict[str, list[str]] = defaultdict(list)
    for action in actions:
        location = f"@{action.location}" if action.location else ""
        grouped[action.agent_name].append(f"{action.action_type}{location}")
    return "; ".join(
        f"{agent_name}[{', '.join(grouped[agent_name])}]"
        for agent_name in sorted(grouped)
    )


def _format_resources(resources: dict[str, float]) -> str:
    ordered = ["food", "water", "materials", "power"]
    return ", ".join(f"{name}={resources.get(name, 0.0):.1f}" for name in ordered)
