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
    assert body["paths"]["/experiments"]["post"]["summary"] == "Create an experiment"
    assert body["paths"]["/experiments/{experiment_id}/log"]["get"]["summary"] == "Query the event log"
    assert body["paths"]["/health"]["get"]["summary"] == "Check backend health"
