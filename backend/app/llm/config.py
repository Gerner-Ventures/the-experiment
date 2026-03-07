from app.core.config import get_settings
from app.llm.models import LLMModelConfig


def get_default_model_configs() -> dict[str, LLMModelConfig]:
    settings = get_settings()
    return {
        "gm": LLMModelConfig(
            role="gm",
            primary_model=settings.gm_model,
            fallback_models=[settings.gm_fallback_model],
            temperature=settings.llm_default_temperature,
            timeout_seconds=settings.llm_timeout_seconds,
        ),
        "agent": LLMModelConfig(
            role="agent",
            primary_model=settings.agent_model,
            fallback_models=[settings.agent_fallback_model],
            temperature=settings.llm_default_temperature,
            timeout_seconds=settings.llm_timeout_seconds,
        ),
        "memory": LLMModelConfig(
            role="memory",
            primary_model=settings.memory_model,
            fallback_models=[settings.memory_fallback_model],
            temperature=0,
            timeout_seconds=settings.llm_timeout_seconds,
        ),
    }
