from __future__ import annotations

import asyncio
import os
import socket
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
import uvicorn
from alembic import command
from alembic.config import Config

from app.core.config import Settings, get_settings
from app.e2e.smoke import SmokeConfig, SmokeFailure, run_smoke
from app.main import create_app

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.asyncio
async def test_smoke_runner_fails_clearly_if_server_is_unavailable() -> None:
    with pytest.raises(SmokeFailure, match="Server unavailable"):
        await run_smoke(SmokeConfig(base_url="http://127.0.0.1:9"))


@pytest.mark.asyncio
async def test_smoke_runner_succeeds_against_local_app_in_mock_mode() -> None:
    database_url = _postgres_database_url()
    if database_url is None or not _database_available(database_url):
        pytest.skip("Local Postgres is not available for smoke testing.")

    _run_migrations(database_url)

    app = create_app(
        settings_override=Settings(
            database_url=database_url,
            backend_runtime_mode="smoke_mock",
        )
    )
    server, task, base_url = await _start_server(app)
    try:
        experiment_id = await run_smoke(SmokeConfig(base_url=base_url))

        async with httpx.AsyncClient(base_url=base_url, timeout=20.0) as client:
            state = await _request_json(client, f"/api/experiments/{experiment_id}")
            assert state["current_round"] == 1

            event_log = await _request_json(client, f"/api/experiments/{experiment_id}/log")
            assert event_log["total"] >= 1
    finally:
        server.should_exit = True
        await task


async def _start_server(app: Any) -> tuple[uvicorn.Server, asyncio.Task[None], str]:
    port = _free_port()
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    for _ in range(100):
        if server.started:
            return server, task, f"http://127.0.0.1:{port}"
        await asyncio.sleep(0.05)
    server.should_exit = True
    await task
    raise AssertionError("Timed out waiting for uvicorn test server to start.")


def _run_migrations(database_url: str) -> None:
    previous_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    get_settings.cache_clear()
    try:
        config = Config(str(ROOT / "alembic.ini"))
        command.upgrade(config, "head")
    finally:
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url
        get_settings.cache_clear()


def _postgres_database_url() -> str | None:
    if os.environ.get("BACKEND_E2E_DATABASE_URL"):
        return os.environ["BACKEND_E2E_DATABASE_URL"]
    get_settings.cache_clear()
    return get_settings().database_url


def _database_available(database_url: str) -> bool:
    try:
        with psycopg.connect(_sync_database_url(database_url), connect_timeout=1):
            return True
    except psycopg.Error:
        return False


def _sync_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    if database_url.startswith("postgresql+psycopg://"):
        return database_url
    if database_url.startswith("postgresql+"):
        return "postgresql://" + database_url.split("://", 1)[1]
    return database_url


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


async def _request_json(client: httpx.AsyncClient, path: str) -> dict[str, Any]:
    response = await client.get(path)
    response.raise_for_status()
    body = response.json()
    assert isinstance(body, dict)
    return body
