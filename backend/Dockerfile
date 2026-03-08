# ── Stage 1: Install dependencies ──────────────────────
FROM python:3.13.2-slim-bookworm AS build

WORKDIR /app

RUN pip install poetry && poetry config virtualenvs.in-project true

COPY pyproject.toml poetry.lock* ./
RUN poetry install --only main --no-interaction --no-ansi

COPY . .

# ── Stage 2: Production runtime ────────────────────────
FROM python:3.13.2-slim-bookworm

RUN groupadd -r app -g 1001 && \
    useradd -r -g app -u 1001 -d /app app

WORKDIR /app

COPY --from=build /app/.venv /app/.venv
COPY --from=build /app .

ENV PATH="/app/.venv/bin:$PATH"

USER 1001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
