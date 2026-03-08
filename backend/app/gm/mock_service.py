from __future__ import annotations

from app.gm.models import GMPlanningContext, GMPlanRecord
from app.gm.planner import generate_rule_based_plan
from app.gm.service import GMService


class RuleBasedGMService(GMService):
    def __init__(self) -> None:
        # Mock runs should never touch live LLM clients.
        pass

    async def generate_plan(self, context: GMPlanningContext) -> GMPlanRecord:
        record = GMPlanRecord(plan=generate_rule_based_plan(context))
        if context.auto_approve:
            return self.apply_plan(self.approve_plan(record))
        return record
