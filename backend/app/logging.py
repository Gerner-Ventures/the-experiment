import logging
import os

import structlog

_log_provider = None


def _setup_otel_logging(log_level: int) -> None:
    global _log_provider

    posthog_key = os.environ.get("POSTHOG_KEY")
    if not posthog_key:
        return

    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
    from opentelemetry.sdk.resources import Resource

    endpoint = os.environ.get("POSTHOG_OTLP_ENDPOINT", "https://us.i.posthog.com/i/v1")

    resource = Resource.create(
        {
            "service.name": "the-experiment-backend",
            "service.version": os.environ.get("APP_VERSION", "0.1.0"),
            "deployment.environment": os.environ.get("ENV", "development"),
        }
    )

    exporter = OTLPLogExporter(
        endpoint=f"{endpoint}/logs",
        headers={"Authorization": f"Bearer {posthog_key}"},
    )

    _log_provider = LoggerProvider(resource=resource)
    _log_provider.add_log_record_processor(BatchLogRecordProcessor(exporter))

    otel_handler = LoggingHandler(level=log_level, logger_provider=_log_provider)
    logging.getLogger().addHandler(otel_handler)


def shutdown_logging() -> None:
    if _log_provider is not None:
        _log_provider.shutdown()  # type: ignore[no-untyped-call]


def setup_logging() -> None:
    log_level = os.environ.get("LOG_LEVEL", "info").upper()

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    numeric_level = getattr(logging, log_level)
    logging.basicConfig(format="%(message)s", level=numeric_level)
    _setup_otel_logging(numeric_level)
