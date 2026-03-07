from fastapi.testclient import TestClient

from app.api.runtime import ExperimentRuntime
from app.api.store import InMemoryExperimentStore
from app.main import create_app


def test_create_app_uses_injected_runtime() -> None:
    runtime = ExperimentRuntime(store=InMemoryExperimentStore())
    app = create_app(runtime=runtime)

    assert app.state.runtime is runtime

    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
