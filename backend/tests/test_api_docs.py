from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_docs_and_openapi_endpoints_are_available() -> None:
    docs = client.get("/docs")
    assert docs.status_code == 200
    assert "Swagger UI" in docs.text

    redoc = client.get("/redoc")
    assert redoc.status_code == 200
    assert "ReDoc" in redoc.text

    openapi = client.get("/openapi.json")
    assert openapi.status_code == 200

    body = openapi.json()
    assert body["info"]["title"]
    assert body["paths"]["/api/experiments"]["post"]["summary"] == "Create an experiment"
    assert (
        body["paths"]["/api/experiments/{experiment_id}/log"]["get"]["summary"]
        == "Query the event log"
    )
    assert (
        body["paths"]["/api/experiments/{experiment_id}/gm/revise"]["post"]["summary"]
        == "Revise the next GM plan from feedback"
    )
    assert (
        body["paths"]["/api/experiments/{experiment_id}/analytics/summary"]["get"]["summary"]
        == "Get experiment analytics summary"
    )
    assert (
        body["paths"]["/api/experiments/{experiment_id}/analytics/rounds"]["get"]["summary"]
        == "Get round analytics"
    )
    assert (
        body["paths"]["/api/experiments/{experiment_id}/rounds/{round_number}/narration"]["get"][
            "summary"
        ]
        == "Get round narration metadata"
    )
    assert (
        body["paths"]["/api/experiments/{experiment_id}/highlights"]["get"]["summary"]
        == "Get experiment highlights"
    )
    assert (
        body["paths"]["/api/experiments/{experiment_id}/usage"]["get"]["summary"]
        == "Get LLM usage report"
    )
    assert body["paths"]["/api/health"]["get"]["summary"] == "Liveness check"
    assert body["paths"]["/api/health/ready"]["get"]["summary"] == "Readiness check"
    assert body["paths"]["/api/runtime/llm-mode"]["get"]["summary"] == "Get backend LLM mode"
    assert body["paths"]["/api/runtime/llm-mode"]["put"]["summary"] == "Set backend LLM mode"
