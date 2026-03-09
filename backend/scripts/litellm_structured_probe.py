"""Probe script to explore litellm's native structured output behavior.

Run from backend/:
    .venv/bin/python -m scripts.litellm_structured_probe
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.doppler"))

import litellm  # noqa: E402
from pydantic import BaseModel, ValidationError  # noqa: E402

from app.llm.client import _add_additional_properties_false  # noqa: E402
from app.schemas.agent_decision import AgentDecision, AGENT_DECISION_MAX_TOKENS  # noqa: E402


SYSTEM_PROMPT = """You are an AI agent in a survival simulation game. You must decide what to do this round.

Respond with a JSON object with these TOP-LEVEL fields:
- inner_thought: your brief reasoning (1-2 sentences)
- suspicion: any suspicions about other agents, or null
- action: an object with "type" (e.g. "observe", "gather", "explore"), and optionally "target" and "location"
- dialogue: null or an object with "target" and "message"
- goal_progress: brief note on your goal progress
- cooperation_intent: one of "high", "medium", "low", "none"
"""

USER_PROMPT = """Round 3. You are "The Engineer". Your secret goal is to hoard materials.
The group just discovered someone has been stealing food. Tensions are high.
What do you do?"""

HAIKU = "anthropic/claude-haiku-4-5-20251001"
SONNET = "anthropic/claude-sonnet-4-6"
ITERATIONS = 3


def make_json_schema_format(model_cls: type[BaseModel]) -> dict[str, Any]:
    """Build json_schema dict with additionalProperties: false (what our client does)."""
    schema = model_cls.model_json_schema()
    _add_additional_properties_false(schema)
    return {
        "type": "json_schema",
        "json_schema": {
            "name": model_cls.__name__,
            "schema": schema,
            "strict": True,
        },
    }


async def test_iteration(
    *,
    model: str,
    response_format: type[BaseModel] | dict[str, Any] | None,
    enable_validation: bool,
    use_router: bool = False,
) -> dict[str, Any]:
    """Run a single test and return results dict."""
    litellm.enable_json_schema_validation = enable_validation

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_PROMPT},
    ]

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": AGENT_DECISION_MAX_TOKENS,
        "temperature": 0.7,
    }
    if response_format is not None:
        kwargs["response_format"] = response_format

    try:
        if use_router:
            router = litellm.Router(
                model_list=[{"model_name": model, "litellm_params": {"model": model}}],
                num_retries=0,
            )
            response = await router.acompletion(**kwargs)
        else:
            response = await litellm.acompletion(**kwargs)

        content = response.choices[0].message.content
        finish_reason = response.choices[0].finish_reason

        try:
            parsed = json.loads(content)
            json_valid = True
        except (json.JSONDecodeError, TypeError):
            parsed = None
            json_valid = False

        nesting_bug = False
        if parsed and isinstance(parsed, dict) and "action" in parsed:
            if isinstance(parsed["action"], dict) and "inner_thought" in parsed["action"]:
                nesting_bug = True

        pydantic_valid = False
        if parsed:
            try:
                AgentDecision.model_validate(parsed)
                pydantic_valid = True
            except ValidationError:
                pass

        return {
            "status": "ok",
            "json_valid": json_valid,
            "pydantic_valid": pydantic_valid,
            "nesting_bug": nesting_bug,
            "finish_reason": finish_reason,
            "top_keys": list(parsed.keys()) if parsed and isinstance(parsed, dict) else None,
        }

    except Exception as e:
        return {
            "status": "error",
            "error_type": type(e).__name__,
            "error": str(e)[:300],
        }


async def run_test_suite(
    name: str,
    *,
    model: str,
    response_format: type[BaseModel] | dict[str, Any] | None,
    enable_validation: bool,
    use_router: bool = False,
    iterations: int = ITERATIONS,
) -> None:
    print(f"\n{'='*70}")
    print(f"TEST: {name} ({iterations} iterations, model={model})")
    print(f"{'='*70}")

    results = []
    for i in range(iterations):
        result = await test_iteration(
            model=model,
            response_format=response_format,
            enable_validation=enable_validation,
            use_router=use_router,
        )
        results.append(result)
        status = "OK" if result["status"] == "ok" else "ERR"
        if result["status"] == "ok":
            flags = []
            if result["json_valid"]:
                flags.append("json:ok")
            else:
                flags.append("json:FAIL")
            if result["pydantic_valid"]:
                flags.append("pydantic:ok")
            else:
                flags.append("pydantic:FAIL")
            if result["nesting_bug"]:
                flags.append("NESTED!")
            print(f"  [{i+1}] {status} {' | '.join(flags)} | keys={result['top_keys']}")
        else:
            print(f"  [{i+1}] {status} {result['error_type']}: {result['error'][:100]}")

    ok_count = sum(1 for r in results if r["status"] == "ok")
    json_ok = sum(1 for r in results if r.get("json_valid"))
    pydantic_ok = sum(1 for r in results if r.get("pydantic_valid"))
    nested = sum(1 for r in results if r.get("nesting_bug"))
    errors = sum(1 for r in results if r["status"] == "error")

    print(
        f"\n  SUMMARY: {ok_count}/{iterations} ok, "
        f"{json_ok} json valid, {pydantic_ok} pydantic valid, "
        f"{nested} nesting bugs, {errors} errors"
    )


async def main() -> None:
    print("Testing litellm structured output with additionalProperties fix")
    print(f"Iterations per config: {ITERATIONS}")

    json_schema_fmt = make_json_schema_format(AgentDecision)

    # Sonnet with json_schema + additionalProperties: false (the fix)
    await run_test_suite(
        "Sonnet: json_schema + additionalProperties:false",
        model=SONNET,
        response_format=json_schema_fmt,
        enable_validation=False,
        use_router=True,
    )

    # Haiku with json_schema + additionalProperties: false
    await run_test_suite(
        "Haiku: json_schema + additionalProperties:false",
        model=HAIKU,
        response_format=json_schema_fmt,
        enable_validation=False,
        use_router=True,
    )

    # Sonnet with raw BaseModel (should fail with additionalProperties error)
    await run_test_suite(
        "Sonnet: raw BaseModel (expect failure)",
        model=SONNET,
        response_format=AgentDecision,
        enable_validation=False,
        use_router=True,
        iterations=1,
    )


if __name__ == "__main__":
    asyncio.run(main())
