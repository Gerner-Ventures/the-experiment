"""Tests for Langfuse configuration and lifecycle (S3.6 sections 1, 3 + 5)."""

from unittest.mock import MagicMock, patch

import pytest

import app.llm.client as llm_client_module
import app.llm.config as llm_config_module
from app.core.config import Settings


# --- Section 3: Configuration ---


class TestLangfuseSettings:
    def test_langfuse_fields_default_to_none(self) -> None:
        settings = Settings()

        assert settings.langfuse_public_key is None
        assert settings.langfuse_secret_key is None
        assert settings.langfuse_host is None

    def test_langfuse_enabled_when_both_keys_set(self) -> None:
        settings = Settings(
            langfuse_public_key="pk-lf-test",
            langfuse_secret_key="sk-lf-test",
        )

        assert settings.langfuse_enabled is True

    def test_langfuse_disabled_when_public_key_missing(self) -> None:
        settings = Settings(langfuse_secret_key="sk-lf-test")

        assert settings.langfuse_enabled is False

    def test_langfuse_disabled_when_secret_key_missing(self) -> None:
        settings = Settings(langfuse_public_key="pk-lf-test")

        assert settings.langfuse_enabled is False

    def test_langfuse_disabled_when_no_keys(self) -> None:
        settings = Settings()

        assert settings.langfuse_enabled is False

    def test_langfuse_host_configurable(self) -> None:
        settings = Settings(
            langfuse_public_key="pk-lf-test",
            langfuse_secret_key="sk-lf-test",
            langfuse_host="https://langfuse.example.com",
        )

        assert settings.langfuse_host == "https://langfuse.example.com"


# --- Section 5: Graceful Lifecycle ---


class TestLangfuseLifecycle:
    def test_init_returns_none_when_disabled(self) -> None:
        from app.core import langfuse

        langfuse._client = None
        langfuse.init()

        assert langfuse._client is None

    def test_init_creates_client_when_enabled(self) -> None:
        import importlib
        import sys

        from app.core import langfuse

        langfuse._client = None
        mock_instance = MagicMock()
        mock_langfuse_cls = MagicMock(return_value=mock_instance)
        mock_module = MagicMock(Langfuse=mock_langfuse_cls)

        # Remove cached langfuse module so the local import inside init() picks up our mock
        saved = sys.modules.pop("langfuse", None)
        sys.modules["langfuse"] = mock_module
        try:
            with patch("app.core.langfuse.get_settings") as mock_settings:
                mock_settings.return_value = Settings(
                    langfuse_public_key="pk-lf-test",
                    langfuse_secret_key="sk-lf-test",
                    langfuse_host="https://cloud.langfuse.com",
                )
                langfuse.init()

                mock_langfuse_cls.assert_called_once_with(
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                    host="https://cloud.langfuse.com",
                )
                assert langfuse._client is mock_instance
        finally:
            if saved is not None:
                sys.modules["langfuse"] = saved
            else:
                sys.modules.pop("langfuse", None)
            langfuse._client = None

    def test_shutdown_flushes_client(self) -> None:
        from app.core import langfuse

        mock_client = MagicMock()
        langfuse._client = mock_client

        langfuse.shutdown()

        mock_client.flush.assert_called_once()
        langfuse._client = None

    def test_shutdown_noop_when_no_client(self) -> None:
        from app.core import langfuse

        langfuse._client = None
        langfuse.shutdown()  # should not raise

    def test_shutdown_resets_client(self) -> None:
        from app.core import langfuse

        mock_client = MagicMock()
        langfuse._client = mock_client

        langfuse.shutdown()

        assert langfuse._client is None

    def test_tracing_errors_do_not_propagate(self) -> None:
        from app.core import langfuse

        mock_client = MagicMock()
        mock_client.trace.side_effect = RuntimeError("langfuse down")
        langfuse._client = mock_client

        # Should not raise — fire-and-forget
        result = langfuse.trace(name="test-trace", session_id="exp-1")
        assert result is None
        langfuse._client = None


# --- Section 1: litellm Callback Integration ---


class TestLitellmCallbackIntegration:
    def test_langfuse_callback_registered_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import litellm

        settings = Settings(
            langfuse_public_key="pk-lf-test",
            langfuse_secret_key="sk-lf-test",
        )
        monkeypatch.setattr(llm_client_module, "get_settings", lambda: settings)
        monkeypatch.setattr(llm_config_module, "get_settings", lambda: settings)
        # Clear any existing callbacks
        monkeypatch.setattr(litellm, "success_callback", [])
        monkeypatch.setattr(litellm, "failure_callback", [])

        from app.llm import LLMClient

        LLMClient()

        assert "langfuse" in litellm.success_callback
        assert "langfuse" in litellm.failure_callback

    def test_langfuse_callback_not_registered_when_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import litellm

        settings = Settings()
        monkeypatch.setattr(llm_client_module, "get_settings", lambda: settings)
        monkeypatch.setattr(llm_config_module, "get_settings", lambda: settings)
        monkeypatch.setattr(litellm, "success_callback", [])
        monkeypatch.setattr(litellm, "failure_callback", [])

        from app.llm import LLMClient

        LLMClient()

        assert "langfuse" not in litellm.success_callback
        assert "langfuse" not in litellm.failure_callback
