from __future__ import annotations

import contextvars
import logging
from typing import TYPE_CHECKING, Any

from app.core.config import get_settings

if TYPE_CHECKING:
    from langfuse import Langfuse

logger = logging.getLogger(__name__)

_client: Langfuse | None = None
_trace_context: contextvars.ContextVar[dict[str, str] | None] = contextvars.ContextVar(
    "langfuse_trace_context", default=None
)


def init() -> None:
    global _client
    settings = get_settings()
    if not settings.langfuse_enabled:
        return
    from langfuse import Langfuse

    _client = Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_host,
    )


def shutdown() -> None:
    global _client
    if _client is not None:
        _client.flush()
        _client = None


def trace(*, name: str, session_id: str | None = None, **kwargs: Any) -> Any:
    if _client is None:
        return None
    try:
        return _client.trace(name=name, session_id=session_id, **kwargs)
    except Exception:
        logger.warning("langfuse trace failed", exc_info=True)
        return None


def set_trace_context(trace_id: str, span_id: str) -> contextvars.Token[dict[str, str] | None]:
    return _trace_context.set({"trace_id": trace_id, "parent_observation_id": span_id})


def get_trace_context() -> dict[str, str]:
    return _trace_context.get() or {}


def reset_trace_context() -> None:
    _trace_context.set(None)


def span(*, name: str, parent: Any = None, **kwargs: Any) -> Any:
    if parent is None:
        return None
    try:
        return parent.span(name=name, **kwargs)
    except Exception:
        logger.warning("langfuse span failed", exc_info=True)
        return None


def record_scores(*, trace_id: str, scores: dict[str, float]) -> None:
    if _client is None:
        return
    for name, value in scores.items():
        try:
            _client.score(
                trace_id=trace_id,
                name=name,
                value=value,
            )
        except Exception:
            logger.warning("langfuse score failed for %s", name, exc_info=True)


def log_event(*, name: str, metadata: dict[str, Any] | None = None) -> None:
    ctx = get_trace_context()
    if not ctx or _client is None:
        return
    try:
        _client.event(
            trace_id=ctx.get("trace_id"),
            parent_observation_id=ctx.get("parent_observation_id"),
            name=name,
            metadata=metadata or {},
        )
    except Exception:
        logger.warning("langfuse event failed", exc_info=True)
