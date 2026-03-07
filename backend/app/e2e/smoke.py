from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
import websockets

REQUIRED_WS_TYPES = {
    "round_start",
    "gm_plan",
    "crisis_event",
    "agent_action",
    "resource_update",
    "threat_update",
    "round_end",
}
DEFAULT_SCENARIO_PATH = Path(__file__).with_name("scenarios") / "default_experiment.json"


class SmokeFailure(RuntimeError):
    pass


@dataclass(slots=True)
class SmokeConfig:
    base_url: str = "http://127.0.0.1:8000"
    scenario_path: Path = DEFAULT_SCENARIO_PATH
    timeout_seconds: float = 20.0


async def run_smoke(config: SmokeConfig) -> str:
    payload = _load_payload(config.scenario_path)
    transport_error: httpx.TransportError | None = None
    timeout = httpx.Timeout(config.timeout_seconds)

    try:
        async with httpx.AsyncClient(base_url=config.base_url, timeout=timeout) as client:
            print(f"[smoke] Health check: {config.base_url}/api/health")
            health = await _request_json(client, "GET", "/api/health")
            _require(health.get("status") == "ok", "Health payload missing status=ok.")

            print("[smoke] Create experiment")
            created = await _request_json(client, "POST", "/api/experiments", json_body=payload)
            experiment_id = _require_string(created, "experiment_id")

            print("[smoke] Load GM plan")
            gm_plan = await _request_json(client, "GET", f"/api/experiments/{experiment_id}/gm/plan")
            _require_string(gm_plan, "status")

            print("[smoke] Approve GM plan")
            approved = await _request_json(
                client,
                "POST",
                f"/api/experiments/{experiment_id}/gm/approve",
                json_body={},
            )
            _require(approved.get("status") in {"approved", "applied", "modified"}, "GM approval failed.")

            print("[smoke] Connect websocket")
            ws_url = _websocket_url(config.base_url, f"/api/experiments/{experiment_id}/ws")
            async with websockets.connect(ws_url) as websocket:
                connected = json.loads(
                    await asyncio.wait_for(websocket.recv(), timeout=config.timeout_seconds)
                )
                _require(connected.get("type") == "connected", "WebSocket did not send connected message.")

                print("[smoke] Step one round")
                stepped = await _request_json(client, "POST", f"/api/experiments/{experiment_id}/step")
                round_result = _require_mapping(stepped, "round_result")
                _require(round_result.get("round_number") == 1, "Round step did not advance to round 1.")

                seen_types = await _collect_ws_types(websocket, timeout_seconds=config.timeout_seconds)
                missing = REQUIRED_WS_TYPES - seen_types
                _require(
                    not missing,
                    "WebSocket stream missing required message types: " + ", ".join(sorted(missing)),
                )

            print("[smoke] Fetch current experiment state")
            state = await _request_json(client, "GET", f"/api/experiments/{experiment_id}")
            _require(state.get("current_round") == 1, "Experiment state was not persisted after step.")

            print("[smoke] Fetch event log")
            log = await _request_json(client, "GET", f"/api/experiments/{experiment_id}/log")
            _require(log.get("total", 0) >= 1, "Event log is empty after stepping.")

            print("[smoke] Fetch analytics summary")
            summary = await _request_json(
                client,
                "GET",
                f"/api/experiments/{experiment_id}/analytics/summary",
            )
            _require(summary.get("rounds_completed") == 1, "Analytics summary did not reflect completed round.")

            print("[smoke] Fetch replay index")
            replay = await _request_json(client, "GET", f"/api/experiments/{experiment_id}/replay")
            rounds = replay.get("rounds", [])
            _require(
                isinstance(rounds, list) and len(rounds) > 0,
                "Replay index did not return any completed rounds.",
            )

            print("[smoke] Fetch round snapshot")
            snapshot = await _request_json(
                client,
                "GET",
                f"/api/experiments/{experiment_id}/rounds/1/snapshot",
            )
            _require(snapshot.get("round_number") == 1, "Round snapshot did not return round 1.")
            events = snapshot.get("events")
            _require(isinstance(events, list) and len(events) > 0, "Round snapshot did not include events.")

            print(f"[smoke] PASS experiment_id={experiment_id}")
            return experiment_id
    except httpx.TransportError as exc:
        transport_error = exc

    assert transport_error is not None
    raise SmokeFailure(f"Server unavailable at {config.base_url}: {transport_error}") from transport_error


async def _request_json(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    *,
    json_body: Any | None = None,
) -> dict[str, Any]:
    response = await client.request(method, path, json=json_body)
    if response.status_code >= 400:
        raise SmokeFailure(
            f"{method} {path} failed with {response.status_code}: {response.text.strip()}"
        )
    try:
        body = response.json()
    except ValueError as exc:
        raise SmokeFailure(f"{method} {path} returned malformed JSON.") from exc
    if not isinstance(body, dict):
        raise SmokeFailure(f"{method} {path} did not return a JSON object.")
    return body


async def _collect_ws_types(
    websocket: websockets.ClientConnection,
    *,
    timeout_seconds: float,
) -> set[str]:
    seen_types: set[str] = set()
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while asyncio.get_running_loop().time() < deadline and not REQUIRED_WS_TYPES <= seen_types:
        remaining = deadline - asyncio.get_running_loop().time()
        try:
            raw_message = await asyncio.wait_for(websocket.recv(), timeout=max(remaining, 0.1))
        except TimeoutError:
            break
        message = json.loads(raw_message)
        if isinstance(message, dict) and isinstance(message.get("type"), str):
            seen_types.add(message["type"])
    return seen_types


def _load_payload(path: Path) -> dict[str, Any]:
    try:
        raw_payload = json.loads(path.read_text())
    except OSError as exc:
        raise SmokeFailure(f"Could not read scenario payload at {path}.") from exc
    except json.JSONDecodeError as exc:
        raise SmokeFailure(f"Scenario payload at {path} is not valid JSON.") from exc
    if not isinstance(raw_payload, dict):
        raise SmokeFailure(f"Scenario payload at {path} must be a JSON object.")
    return raw_payload


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def _require_mapping(body: dict[str, Any], key: str) -> dict[str, Any]:
    value = body.get(key)
    if not isinstance(value, dict):
        raise SmokeFailure(f"Expected '{key}' to be an object.")
    return value


def _require_string(body: dict[str, Any], key: str) -> str:
    value = body.get(key)
    if not isinstance(value, str) or not value:
        raise SmokeFailure(f"Expected '{key}' to be a non-empty string.")
    return value


def _websocket_url(base_url: str, path: str) -> str:
    parts = urlsplit(base_url)
    if not parts.scheme.startswith("http"):
        raise SmokeFailure(f"Unsupported base URL: {base_url}")
    ws_scheme = "wss" if parts.scheme == "https" else "ws"
    return urlunsplit((ws_scheme, parts.netloc, path, "", ""))


def _parse_args() -> SmokeConfig:
    parser = argparse.ArgumentParser(description="Run the backend HTTP/websocket smoke flow.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--scenario", default=str(DEFAULT_SCENARIO_PATH))
    parser.add_argument("--timeout-seconds", default=20.0, type=float)
    args = parser.parse_args()
    return SmokeConfig(
        base_url=args.base_url.rstrip("/"),
        scenario_path=Path(args.scenario),
        timeout_seconds=args.timeout_seconds,
    )


async def _main_async() -> int:
    config = _parse_args()
    try:
        await run_smoke(config)
    except SmokeFailure as exc:
        print(f"[smoke] FAIL {exc}")
        return 1
    return 0


def main() -> int:
    return asyncio.run(_main_async())


if __name__ == "__main__":
    raise SystemExit(main())
