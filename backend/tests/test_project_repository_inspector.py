import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routers.projects import router
from backend.app.services.project_repository_inspector import (
    ProjectRepositoryInspectionError,
    ProjectRepositoryInspector,
)
from backend.app.state import Store
from backend.tests.helpers import MemoryRepository


OPENAPI = {
    "openapi": "3.0.3",
    "info": {"title": "Checkout API", "version": "1.0.0"},
    "servers": [{"url": "https://api.example.com"}],
    "paths": {
        "/orders": {
            "get": {"summary": "List orders", "responses": {"200": {"description": "OK"}}},
            "post": {"summary": "Create order", "responses": {"201": {"description": "Created"}}},
        }
    },
}


def target_store():
    existing = {
        "id": "existing", "name": "Existing", "environments": [{
            "id": "env", "name": "Local", "base_url": "", "variables": {},
        }], "current_environment_id": "env", "items": [],
    }
    store = Store(MemoryRepository({
        "current_project_id": "existing", "projects": [existing], "global_variables": {},
    }))
    store.load()
    return store


class ProjectRepositoryInspectorTests(unittest.TestCase):
    def test_discovers_supported_api_files_and_ignores_dependency_folders(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "docs/openapi.json").write_text(json.dumps(OPENAPI), encoding="utf-8")
            (root / "node_modules").mkdir()
            (root / "node_modules/swagger.json").write_text(json.dumps(OPENAPI), encoding="utf-8")

            result = ProjectRepositoryInspector().inspect(directory)

            self.assertEqual(result["mode"], "import_candidates")
            self.assertEqual([item["path"] for item in result["candidates"]], ["docs/openapi.json"])
            self.assertEqual(result["candidates"][0]["summary"]["endpoints"], 2)

    def test_candidate_path_cannot_escape_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ProjectRepositoryInspectionError):
                ProjectRepositoryInspector().load_candidate(directory, "../openapi.json")


class ProjectRepositoryImportRouteTests(unittest.TestCase):
    def test_clone_of_non_beacon_repository_returns_inspection_instead_of_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "openapi.json").write_text(json.dumps(OPENAPI), encoding="utf-8")
            store = target_store()
            app = FastAPI()
            app.include_router(router)

            with patch("backend.app.routers.projects.store", store), patch.object(
                store.project_git, "clone", return_value=root,
            ):
                response = TestClient(app).post("/projects/file-sync/clone", json={
                    "url": "git@github.com:team/source-api.git", "destination": str(root.parent),
                })

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["mode"], "inspection_required")
            self.assertEqual(response.json()["inspection_mode"], "import_candidates")
            self.assertEqual(response.json()["candidates"][0]["path"], "openapi.json")
            self.assertEqual(len(store.projects), 1)

    def test_import_candidate_creates_linked_project_inside_source_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "openapi.json").write_text(json.dumps(OPENAPI), encoding="utf-8")
            store = target_store()
            app = FastAPI()
            app.include_router(router)

            with patch("backend.app.routers.projects.store", store):
                response = TestClient(app).post("/projects/file-sync/import-candidate", json={
                    "path": directory, "candidate": "openapi.json",
                })

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["imported"]["tests"], 2)
            self.assertEqual(store.current_project_id, response.json()["project_id"])
            self.assertTrue((root / "beacon.yaml").is_file())
            self.assertEqual(store.projects[-1]["file_sync"]["path"], str(root.resolve()))

    def test_initialize_creates_empty_linked_project_without_touching_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "app.py"
            source.write_text("print('source stays')", encoding="utf-8")
            store = target_store()
            app = FastAPI()
            app.include_router(router)

            with patch("backend.app.routers.projects.store", store):
                response = TestClient(app).post("/projects/file-sync/initialize", json={
                    "path": directory, "name": "Source API",
                })

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["project_name"], "Source API")
            self.assertTrue((root / "beacon.yaml").is_file())
            self.assertEqual(source.read_text(encoding="utf-8"), "print('source stays')")
            self.assertEqual(store.projects[-1]["items"], [])
