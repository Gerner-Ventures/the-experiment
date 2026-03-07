from __future__ import annotations

import os

from app.agents.mock_brain import MockAgentBrain
from app.agents.service import AgentService
from app.api.runtime import ExperimentRuntime
from app.api.store import InMemoryExperimentStore
from app.core.config import get_settings
from app.engine import SimulationEngine
from app.gm import GMPlanningContext, GMService, generate_rule_based_plan
from app.gm.models import GMPlanRecord
from app.headless.models import HeadlessMode
from app.llm.config import get_default_model_configs
from app.llm.models import (
    MemoryConsolidationDecision,
    MemoryPromotionDecision,
    RelationshipConsolidationDecision,
)

PROVIDER_ENV_VARS = {
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
    "openai": "OPENAI_API_KEY",
}


class RuleBasedGMService(GMService):
    def __init__(self) -> None:
        # Mock headless runs should never touch live LLM clients.
        pass

    async def generate_plan(self, context: GMPlanningContext) -> GMPlanRecord:
        record = GMPlanRecord(plan=generate_rule_based_plan(context))
        if context.auto_approve:
            return self.apply_plan(self.approve_plan(record))
        return record


class NoOpMemoryLLMService:
    async def classify_memory_event(self, **_: object) -> MemoryPromotionDecision:
        return MemoryPromotionDecision(promote_to_key_memory=False)

    async def consolidate_memory_events(self, **_: object) -> MemoryConsolidationDecision:
        return MemoryConsolidationDecision(create_summary=False)

    async def consolidate_relationship_memory(
        self, **_: object
    ) -> RelationshipConsolidationDecision:
        return RelationshipConsolidationDecision(update_notes=False)


def build_headless_runtime(*, mode: HeadlessMode, seed: int) -> ExperimentRuntime:
    store = InMemoryExperimentStore()
    gm_service: GMService
    if mode == "mock":
        gm_service = RuleBasedGMService()
        agent_service = AgentService(
            brain=MockAgentBrain(seed=seed),
            memory_llm_service=NoOpMemoryLLMService(),
        )
        engine = SimulationEngine(
            gm_service=gm_service,
            agent_service=agent_service,
            random_seed=seed,
        )
        return ExperimentRuntime(store=store, engine=engine, gm_service=gm_service)

    sync_provider_credentials_to_env()
    validate_live_mode_configuration()
    gm_service = GMService()
    engine = SimulationEngine(gm_service=gm_service, random_seed=seed)
    return ExperimentRuntime(store=store, engine=engine, gm_service=gm_service)


def validate_live_mode_configuration() -> None:
    required_providers = _required_live_providers()
    missing_env_vars = [
        PROVIDER_ENV_VARS[provider]
        for provider in sorted(required_providers)
        if not os.getenv(PROVIDER_ENV_VARS[provider])
    ]
    if missing_env_vars:
        missing = ", ".join(missing_env_vars)
        raise ValueError(
            "Live mode requires configured provider credentials before stepping. "
            f"Missing: {missing}."
        )


def sync_provider_credentials_to_env() -> None:
    settings = get_settings()
    for provider, env_var in PROVIDER_ENV_VARS.items():
        value = getattr(settings, _settings_key_for_provider(provider))
        if value and not os.getenv(env_var):
            os.environ[env_var] = value


def _required_live_providers() -> set[str]:
    providers: set[str] = set()
    for config in get_default_model_configs().values():
        for model_name in [config.primary_model, *config.fallback_models]:
            provider = _provider_for_model(model_name)
            if provider in PROVIDER_ENV_VARS:
                providers.add(provider)
    return providers


def _provider_for_model(model_name: str) -> str | None:
    if "/" not in model_name:
        return None
    return model_name.split("/", 1)[0]


def _settings_key_for_provider(provider: str) -> str:
    return {
        "anthropic": "anthropic_api_key",
        "google": "google_api_key",
        "openai": "openai_api_key",
    }[provider]
