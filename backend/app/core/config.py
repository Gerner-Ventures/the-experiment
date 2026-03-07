from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    app_name: str = "the-experiment"
    app_version: str = "0.1.0"
    env: str = "development"
    log_level: str = "debug"
    database_url: str = "postgresql+asyncpg://experiment:experiment@localhost:5432/experiment"
    redis_url: str = "redis://localhost:6379/0"
    platform_url: str | None = None
    cors_origins: list[str] = ["http://localhost:5173"]
    posthog_key: str | None = None
    posthog_host: str = "https://us.posthog.com"
    posthog_enabled: bool = False
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    google_api_key: str | None = None
    gm_model: str = "anthropic/claude-3-5-sonnet-20241022"
    gm_fallback_model: str = "openai/gpt-4o-mini"
    agent_model: str = "openai/gpt-4o-mini"
    agent_fallback_model: str = "anthropic/claude-3-5-haiku-20241022"
    llm_timeout_seconds: float = 45.0
    llm_max_retries: int = 2
    llm_max_fallbacks: int = 2
    llm_default_temperature: float = 0.8

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str) and not value.startswith("["):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def _derive_cors_origins(self) -> "Settings":
        if self.platform_url and self.cors_origins == ["http://localhost:5173"]:
            self.cors_origins = [self.platform_url]
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
