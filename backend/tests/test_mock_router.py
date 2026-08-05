from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.state import store

client = TestClient(app)

def test_mock_router_returns_mocked_response_with_templates():
    pid = "test_mock_project_123"
    project = {
        "id": pid,
        "name": "Mock Test Project",
        "environments": [{"id": "env1", "name": "Default", "base_url": "", "variables": {"user": "Alice"}}],
        "current_environment_id": "env1",
        "items": [
            {
                "id": "ep1",
                "name": "GetUser",
                "url": "/api/users/me",
                "method": "GET",
                "type": "request",
                "mock_response": {
                    "enabled": True,
                    "status": 201,
                    "headers": {"X-Custom": "BeaconMock", "Content-Type": "application/json"},
                    "body": '{"username": "{{user}}", "id": "{{uuid}}"}'
                }
            }
        ]
    }
    store.projects.append(project)
    try:
        response = client.get(f"/mock/projects/{pid}/api/users/me")
        assert response.status_code == 201
        assert response.headers.get("x-custom") == "BeaconMock"
        json_data = response.json()
        assert json_data["username"] == "Alice"
        assert len(json_data["id"]) > 10  # verified generated UUID token
    finally:
        store.projects = [p for p in store.projects if p.get("id") != pid]
