from __future__ import annotations

from datetime import UTC, datetime

from app.llm import LLMService
from app.gm.models import GMPlanData, GMPlanRecord, GMPlanningContext
from app.gm.planner import (
    build_prompt_package,
    build_revision_prompt_package,
    generate_rule_based_plan,
)


class GMService:
    def __init__(self, llm_service: LLMService | None = None) -> None:
        self.llm_service = llm_service or LLMService()

    async def generate_plan(self, context: GMPlanningContext) -> GMPlanRecord:
        prompt = build_prompt_package(context)
        try:
            result = await self.llm_service.generate_gm_plan(
                messages=[
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": prompt.user_prompt},
                ],
                response_format=GMPlanData,
                metadata={
                    "experiment_id": context.experiment_id,
                    "round_number": context.round_number,
                    "tags": ["role:gm"],
                },
                model_override=None,
                generation_name="gm-plan",
            )
            plan = GMPlanData.model_validate(result.parsed or {})
        except Exception:
            plan = generate_rule_based_plan(context)
        record = GMPlanRecord(plan=plan)
        if context.auto_approve:
            return self.apply_plan(self.approve_plan(record))
        return record

    async def revise_plan(
        self,
        context: GMPlanningContext,
        current_plan: GMPlanData,
        feedback: str,
    ) -> GMPlanRecord:
        prompt = build_revision_prompt_package(context, current_plan, feedback)
        result = await self.llm_service.generate_gm_plan(
            messages=[
                {"role": "system", "content": prompt.system_prompt},
                {"role": "user", "content": prompt.user_prompt},
            ],
            response_format=GMPlanData,
            metadata={
                "experiment_id": context.experiment_id,
                "round_number": context.round_number,
                "tags": ["role:gm"],
            },
            model_override=None,
            generation_name="gm-plan-revise",
        )
        plan = GMPlanData.model_validate(result.parsed or {})
        return GMPlanRecord(plan=plan.model_copy(update={"round": current_plan.round}))

    def approve_plan(
        self, record: GMPlanRecord, modified_plan: GMPlanData | None = None
    ) -> GMPlanRecord:
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
