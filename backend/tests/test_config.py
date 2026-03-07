from app.core.config import Settings


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
