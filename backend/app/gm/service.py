from __future__ import annotations

from datetime import UTC, datetime

from app.gm.models import GMPlanData, GMPlanRecord, GMPlanningContext
from app.gm.planner import build_prompt_package, generate_rule_based_plan


class GMService:
    def generate_plan(self, context: GMPlanningContext) -> GMPlanRecord:
        _ = build_prompt_package(context)
        plan = generate_rule_based_plan(context)
        record = GMPlanRecord(plan=plan)
        if context.auto_approve:
            return self.apply_plan(self.approve_plan(record))
        return record

    def approve_plan(self, record: GMPlanRecord, modified_plan: GMPlanData | None = None) -> GMPlanRecord:
        plan = modified_plan or record.plan
        return GMPlanRecord(
            status="modified" if modified_plan is not None else "approved",
            plan=plan,
            approved_at=datetime.now(UTC),
            applied_at=record.applied_at,
        )

    def apply_plan(self, record: GMPlanRecord) -> GMPlanRecord:
        return GMPlanRecord(
            status="applied",
            plan=record.plan,
            approved_at=record.approved_at or datetime.now(UTC),
            applied_at=datetime.now(UTC),
        )
