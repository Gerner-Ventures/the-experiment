from __future__ import annotations

from app.llm.models import UsageRecord, UsageSummary


class UsageTracker:
    def __init__(self) -> None:
        self._records: list[UsageRecord] = []

    def record(self, record: UsageRecord) -> None:
        self._records.append(record)

    def all_records(self) -> list[UsageRecord]:
        return list(self._records)

    def list_records(
        self,
        *,
        experiment_id: str | None = None,
        round_number: int | None = None,
        agent_id: str | None = None,
        role: str | None = None,
    ) -> list[UsageRecord]:
        return [
            record
            for record in self._records
            if (experiment_id is None or record.experiment_id == experiment_id)
            and (round_number is None or record.round_number == round_number)
            and (agent_id is None or record.agent_id == agent_id)
            and (role is None or record.role == role)
        ]

    def summarize(
        self,
        *,
        experiment_id: str | None = None,
        round_number: int | None = None,
        agent_id: str | None = None,
    ) -> UsageSummary:
        summary = UsageSummary()
        for record in self.list_records(
            experiment_id=experiment_id,
            round_number=round_number,
            agent_id=agent_id,
        ):
            summary.request_count += 1
            summary.prompt_tokens += record.usage.prompt_tokens
            summary.completion_tokens += record.usage.completion_tokens
            summary.total_tokens += record.usage.total_tokens
            summary.cost_usd = round(summary.cost_usd + record.usage.cost_usd, 6)
        return summary
