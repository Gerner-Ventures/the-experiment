from __future__ import annotations

from app.gm.models import GMPlanData, GMPlanningContext, GMPlanRecord
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

    async def revise_plan(
        self,
        context: GMPlanningContext,
        current_plan: GMPlanData,
        feedback: str,
    ) -> GMPlanRecord:
        revised = GMPlanData.model_validate(
            {
                **current_plan.model_dump(mode="json"),
                "round_theme": f"{current_plan.round_theme} ({feedback[:40]})",
                "reasoning": (
                    f"{current_plan.reasoning} Revised using GM feedback: {feedback}"
                ).strip(),
                "narration": (
                    f"{current_plan.narration} Feedback steers the town toward: {feedback[:80]}."
                ),
            }
        )
        return GMPlanRecord(plan=revised)
