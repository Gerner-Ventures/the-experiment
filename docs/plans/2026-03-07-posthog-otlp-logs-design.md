# PostHog OTLP Log Export

## Problem

PostHog Logs (`/project/335128/logs`) shows no data because the backend only sends PostHog **events** via the `posthog` Python SDK. PostHog Logs requires logs sent via **OpenTelemetry Protocol (OTLP)**.

## Solution

Add an OpenTelemetry `LoggingHandler` to Python's standard logging module. Since structlog outputs through `stdlib.LoggerFactory()`, all logs flow through Python logging — attaching an OTel handler captures everything.

## Data Flow

```
structlog -> Python logging -> [stdout JSON handler (existing)]
                             -> [OTel LoggingHandler (new)] -> OTLP HTTP exporter -> PostHog
```

## Changes

1. **`backend/pyproject.toml`** — Add `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`
2. **`backend/app/core/config.py`** — Add `posthog_otlp_endpoint` setting (default: `https://us.i.posthog.com/i/v1`)
3. **`backend/app/logging.py`** — Add OTel LoggingHandler + OTLP exporter
4. **`backend/app/main.py`** — Flush OTel log provider on shutdown
5. **`chart/the-experiment/templates/configmap.yaml`** — Add OTLP endpoint env var
6. **`chart/the-experiment/values.yaml`** — Add `posthogOtlpEndpoint` config key

## Auth

PostHog OTLP expects the project API key via `Authorization: Bearer <key>` header on the OTLP exporter.

## What stays the same

- Existing stdout JSON logs (kubectl logs)
- Existing PostHog event capture (`ph.capture()`)
- No new K8s infrastructure
