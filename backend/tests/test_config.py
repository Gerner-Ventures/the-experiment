import pytest

from app.core.config import MAP_NARRATOR_VOICE_IDS, Settings


def test_platform_url_overrides_localhost_cors_default() -> None:
    settings = Settings(platform_url="https://the-experiment.gernerventures.com")

    assert settings.cors_origins == ["https://the-experiment.gernerventures.com"]


def test_explicit_cors_origins_take_precedence_over_platform_url() -> None:
    settings = Settings(
        platform_url="https://the-experiment.gernerventures.com",
        cors_origins=["https://api.example.com"],
    )

    assert settings.cors_origins == ["https://api.example.com"]


def test_cors_origins_accepts_comma_delimited_string() -> None:
    settings = Settings(cors_origins="https://a.example.com, https://b.example.com")

    assert settings.cors_origins == ["https://a.example.com", "https://b.example.com"]


def test_elevenlabs_settings_require_voice_id_when_api_key_is_set() -> None:
    with pytest.raises(ValueError, match="ELEVENLABS_VOICE_ID"):
        Settings(_env_file=None, elevenlabs_api_key="test-key", elevenlabs_voice_id="")


def test_elevenlabs_settings_require_model_id_when_api_key_is_set() -> None:
    with pytest.raises(ValueError, match="ELEVENLABS_MODEL_ID"):
        Settings(
            _env_file=None,
            elevenlabs_api_key="test-key",
            elevenlabs_voice_id="voice-test",
            elevenlabs_model_id="",
        )


def test_map_narrator_voice_ids_are_defined_in_code() -> None:
    assert "Default Town" in MAP_NARRATOR_VOICE_IDS


def test_elevenlabs_voice_and_model_defaults_are_empty_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_VOICE_ID", raising=False)
    monkeypatch.delenv("ELEVENLABS_MODEL_ID", raising=False)

    settings = Settings(_env_file=None)

    assert settings.elevenlabs_voice_id == ""
    assert settings.elevenlabs_model_id == ""
