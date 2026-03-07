from __future__ import annotations

import types

import posthog as _posthog

from app.core.config import get_settings

_client: types.ModuleType | None = None

SYSTEM_ID = "backend-production"


def init() -> None:
    global _client
    settings = get_settings()
    if not settings.posthog_key:
        return
    _posthog.api_key = settings.posthog_key
    _posthog.host = settings.posthog_host
    _posthog.disabled = False
    _client = _posthog


def capture(event: str, properties: dict | None = None) -> None:
    if _client is None:
        return
    _client.capture(SYSTEM_ID, event, properties or {})


def shutdown() -> None:
    if _client is not None:
        _client.flush()
