from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Map-specific narration voices live in code, not env. Leave values empty to
# fall back to ELEVENLABS_VOICE_ID until a distinct voice is chosen.
MAP_NARRATOR_VOICE_IDS: dict[str, str] = {
    "Default Town": "",
}

# Per-character voice IDs for agent speech TTS. Character ID → ElevenLabs voice ID.
CHARACTER_VOICE_IDS: dict[str, str] = {
    "intern": "TX3LPaxmHKxFdv7VOQHJ",          # Liam — energetic, young
    "patient-zero": "IKne3meq5aSn9XLyUdCD",     # Charlie — young, australian
    "volunteer": "bIHbv24MWmeRgasZH58o",         # Will — relaxed optimist
    "whistleblower": "cjVigY5qzO86Huf0OWal",    # Eric — smooth, trustworthy
    "middle-mgmt": "onwK4e9ZLuTAKqWW03F9",      # Daniel — steady broadcaster
    "hall-monitor": "CwhRBWXzGAHq8TQ4Fs17",     # Roger — laid-back, casual
    "influencer": "cgSgspJ2msm6clMCkdW9",       # Jessica — playful, bright
    "politician": "JBFqnCBsd6RMkjVDRZzb",       # George — warm storyteller
    "prepper": "nPczCjzI2devNBz1zQrb",           # Brian — deep, resonant
    "medic": "Xb7hH8MSUJpSbSDYk0k2",            # Alice — clear, engaging
    "engineer": "iP95p4xoKVk53GoZ742B",         # Chris — down-to-earth
    "chef": "N2lVS1w4EtoT3dr4eOWO",             # Callum — husky trickster
    "philosopher": "XrExE9yKIg1WjnnlVkGX",      # Matilda — knowledgeable
    "child": "FGY2WhTYpPnrIDTdsKH5",            # Laura — quirky attitude
    "therapist": "pFZP5JQG7iQjIQuC4Bku",        # Lily — velvety actress
    "con-artist": "SOYHLrjzK2X1ezoPC6cr",       # Harry — fierce warrior
    "nihilist": "SAz9YHcvj6GT2YYXdXww",         # River — relaxed, neutral
    "optimist": "hpp4J3VqNfWAUOO0d1Us",          # Bella — bright, warm
    "conspiracy": "YI5bDiiDOYHHb2eLadHv",       # Storm Styles — dark, suspenseful
    "sleeper": "EXAVITQu4vr4xnSDxMaL",          # Sarah — mature, reassuring
    "clone": "pNInz6obpgDQGcFmaJgB",            # Adam — dominant, firm
    "mascot": "pqHfZKP75CvOlQylNhV4",           # Bill — wise, mature
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "the-experiment"
    app_version: str = "0.1.0"
    env: str = "development"
    log_level: str = "debug"
    backend_runtime_mode: Literal["default", "smoke_mock", "smoke_live"] = "default"
    smoke_seed: int = 11
    database_url: str = "postgresql+asyncpg://experiment:experiment@localhost:5432/experiment"
    redis_url: str = "redis://localhost:6379/0"
    platform_url: str | None = None
    cors_origins: list[str] = ["http://localhost:5173"]
    posthog_key: str | None = None
    posthog_host: str = "https://us.posthog.com"
    posthog_otlp_endpoint: str = "https://us.i.posthog.com/i/v1"
    anthropic_api_key: str | None = None
    gm_model: str = "anthropic/claude-sonnet-4-5-20250514"
    gm_fallback_model: str = "anthropic/claude-haiku-4-5-20251001"
    agent_model: str = "anthropic/claude-haiku-4-5-20251001"
    agent_fallback_model: str = "anthropic/claude-sonnet-4-5-20250514"
    memory_model: str = "anthropic/claude-haiku-4-5-20251001"
    memory_fallback_model: str = "anthropic/claude-sonnet-4-5-20250514"
    llm_timeout_seconds: float = 45.0
    llm_max_retries: int = 2
    llm_max_fallbacks: int = 2
    llm_default_temperature: float = 0.8
    elevenlabs_api_key: str | None = None
    elevenlabs_voice_id: str = ""
    elevenlabs_model_id: str = ""
    elevenlabs_output_format: str = "mp3_44100_128"
    elevenlabs_timeout_seconds: float = 8.0
    elevenlabs_stability: float | None = 0.6
    elevenlabs_similarity_boost: float | None = 0.75
    elevenlabs_style: float | None = 0.0
    elevenlabs_speed: float | None = 0.95
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str | None = None

    @property
    def langfuse_enabled(self) -> bool:
        return bool(self.langfuse_public_key) and bool(self.langfuse_secret_key)

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
        if self.elevenlabs_api_key:
            if not self.elevenlabs_voice_id.strip():
                raise ValueError("ELEVENLABS_VOICE_ID must be set when ELEVENLABS_API_KEY is set.")
            if not self.elevenlabs_model_id.strip():
                raise ValueError("ELEVENLABS_MODEL_ID must be set when ELEVENLABS_API_KEY is set.")
            if not self.elevenlabs_output_format.strip():
                raise ValueError(
                    "ELEVENLABS_OUTPUT_FORMAT must be set when ELEVENLABS_API_KEY is set."
                )
            for map_name, voice_id in MAP_NARRATOR_VOICE_IDS.items():
                if not str(map_name).strip() or not str(voice_id).strip():
                    continue
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
