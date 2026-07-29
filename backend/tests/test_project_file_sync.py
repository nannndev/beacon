import tempfile
import unittest
import shutil
from pathlib import Path
from unittest.mock import patch

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routers.projects import router
from backend.app.services.project_file_sync import ProjectFileSyncError, ProjectFileSyncService
from backend.app.state import Store
from backend.tests.helpers import MemoryRepository


def sample_project():
    return {
        "id": "project-1",
        "name": "Checkout API",
        "current_environment_id": "env-1",
        "environments": [{
            "id": "env-1",
            "name": "Local",
            "base_url": "http://localhost:8000",
            "variables": {"locale": "id-ID", "access_token": "secret-value"},
        }],
        "items": [{
            "type": "folder",
            "id": "folder-1",
            "name": "Auth",
            "items": [{
                "type": "request",
                "id": "endpoint-1",
                "name": "Login",
                "method": "POST",
                "url": "/login",
                "headers": {"Content-Type": "application/json"},
                "payload": {"email": "{{random_email}}"},
                "payload_type": "json",
                "assertions": [{"type": "status", "op": "eq", "value": 200}],
                "extractors": {"access_token": "body.access_token"},
            }],
        }],
    }


class ProjectFileSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.service = ProjectFileSyncService()
        self.project = sample_project()

    def tearDown(self):
        self.temp.cleanup()

    def test_link_writes_readable_source_and_keeps_secret_local(self):
        status = self.service.link(self.project, str(self.root))

        self.assertEqual(status["state"], "clean")
        self.assertIn(".beacon/", (self.root / ".gitignore").read_text())
        manifest = yaml.safe_load((self.root / "beacon.yaml").read_text())
        environment_path = manifest["project"]["environments"][0]
        environment = yaml.safe_load((self.root / environment_path).read_text())
        local = yaml.safe_load((self.root / ".beacon/environments.local.yaml").read_text())

        self.assertEqual(environment["variables"]["locale"], "id-ID")
        self.assertIsNone(environment["variables"]["access_token"])
        self.assertNotIn("secret-value", (self.root / environment_path).read_text())
        self.assertEqual(local["environments"]["env-1"]["access_token"], "secret-value")

    def test_external_edit_is_detected_and_not_overwritten(self):
        self.service.link(self.project, str(self.root))
        manifest = yaml.safe_load((self.root / "beacon.yaml").read_text())
        endpoint_path = manifest["project"]["items"][0]["items"][0]["file"]
        endpoint_file = self.root / endpoint_path
        endpoint = yaml.safe_load(endpoint_file.read_text())
        endpoint["name"] = "Login externally"
        endpoint_file.write_text(yaml.safe_dump(endpoint, sort_keys=False), encoding="utf-8")

        status = self.service.status(self.project)
        self.assertEqual(status["state"], "external_changes")
        self.assertEqual(status["changes"], [{"path": endpoint_path, "kind": "modified"}])

        self.project["name"] = "Changed inside Beacon"
        self.service.sync_before_save(self.project)
        self.assertEqual(self.service.status(self.project)["state"], "conflict")
        self.assertEqual(yaml.safe_load(endpoint_file.read_text())["name"], "Login externally")

    def test_unrelated_workspace_save_does_not_turn_external_change_into_conflict(self):
        self.service.link(self.project, str(self.root))
        manifest = yaml.safe_load((self.root / "beacon.yaml").read_text())
        endpoint_path = manifest["project"]["items"][0]["items"][0]["file"]
        endpoint_file = self.root / endpoint_path
        endpoint = yaml.safe_load(endpoint_file.read_text())
        endpoint["name"] = "External name"
        endpoint_file.write_text(yaml.safe_dump(endpoint, sort_keys=False), encoding="utf-8")

        self.service.sync_before_save(self.project)

        self.assertEqual(self.service.status(self.project)["state"], "external_changes")
        self.assertFalse(self.project["file_sync"]["local_dirty"])

    def test_reload_round_trips_external_endpoint_changes_and_private_overlay(self):
        self.service.link(self.project, str(self.root))
        manifest = yaml.safe_load((self.root / "beacon.yaml").read_text())
        endpoint_path = manifest["project"]["items"][0]["items"][0]["file"]
        endpoint_file = self.root / endpoint_path
        endpoint = yaml.safe_load(endpoint_file.read_text())
        endpoint["url"] = "/v2/login"
        endpoint_file.write_text(yaml.safe_dump(endpoint, sort_keys=False), encoding="utf-8")

        status = self.service.reload(self.project)

        self.assertEqual(status["state"], "clean")
        self.assertEqual(self.project["items"][0]["items"][0]["url"], "/v2/login")
        self.assertEqual(self.project["environments"][0]["variables"]["access_token"], "secret-value")

    def test_reload_rejects_resource_path_traversal_without_mutating_project(self):
        self.service.link(self.project, str(self.root))
        manifest_path = self.root / "beacon.yaml"
        manifest = yaml.safe_load(manifest_path.read_text())
        manifest["project"]["environments"] = ["../outside.yaml"]
        manifest_path.write_text(yaml.safe_dump(manifest, sort_keys=False), encoding="utf-8")
        previous_name = self.project["name"]

        with self.assertRaises(ProjectFileSyncError):
            self.service.reload(self.project)

        self.assertEqual(self.project["name"], previous_name)

    def test_unlink_never_deletes_project_files(self):
        self.service.link(self.project, str(self.root))
        status = self.service.unlink(self.project)

        self.assertEqual(status["state"], "unlinked")
        self.assertTrue((self.root / "beacon.yaml").is_file())

    def test_link_rejects_existing_yaml_in_reserved_project_folders(self):
        (self.root / "endpoints").mkdir()
        existing = self.root / "endpoints/routes.yaml"
        existing.write_text("source: application\n", encoding="utf-8")

        with self.assertRaisesRegex(ProjectFileSyncError, "reserved endpoints"):
            self.service.link(self.project, str(self.root))

        self.assertEqual(existing.read_text(encoding="utf-8"), "source: application\n")
        self.assertFalse((self.root / "beacon.yaml").exists())

    def test_open_existing_builds_project_and_reports_missing_local_secrets(self):
        self.service.link(self.project, str(self.root))
        shutil.rmtree(self.root / ".beacon")

        opened = self.service.open_existing(str(self.root), set())

        self.assertEqual(opened["id"], self.project["id"])
        self.assertEqual(opened["items"][0]["items"][0]["name"], "Login")
        self.assertEqual(opened["environments"][0]["variables"]["access_token"], "")
        self.assertEqual(self.service.missing_private_values(opened), [{
            "environment_id": "env-1", "environment_name": "Local", "key": "access_token",
        }])
        with self.assertRaisesRegex(ProjectFileSyncError, "already open"):
            self.service.open_existing(str(self.root), {self.project["id"]})


class ProjectFileSyncRouteTests(unittest.TestCase):
    def test_link_status_reload_and_unlink_routes(self):
        with tempfile.TemporaryDirectory() as directory:
            project = sample_project()
            target_store = Store(MemoryRepository({
                "current_project_id": project["id"],
                "projects": [project],
                "global_variables": {},
            }))
            target_store.load()
            app = FastAPI()
            app.include_router(router)

            with patch("backend.app.routers.projects.store", target_store):
                client = TestClient(app)
                linked = client.post(f"/projects/{project['id']}/file-sync/link", json={"path": directory})
                self.assertEqual(linked.status_code, 200)
                self.assertEqual(linked.json()["state"], "clean")

                status = client.get(f"/projects/{project['id']}/file-sync")
                self.assertEqual(status.status_code, 200)
                self.assertTrue(status.json()["linked"])

                reloaded = client.post(f"/projects/{project['id']}/file-sync/reload")
                self.assertEqual(reloaded.status_code, 200)
                self.assertEqual(reloaded.json()["state"], "clean")

                unlinked = client.delete(f"/projects/{project['id']}/file-sync")
                self.assertEqual(unlinked.status_code, 200)
                self.assertEqual(unlinked.json()["state"], "unlinked")
                self.assertTrue((Path(directory) / "beacon.yaml").is_file())

    def test_store_save_updates_linked_endpoint_file(self):
        with tempfile.TemporaryDirectory() as directory:
            project = sample_project()
            target_store = Store(MemoryRepository({
                "current_project_id": project["id"],
                "projects": [project],
                "global_variables": {},
            }))
            target_store.load()
            target_store.file_sync.link(target_store.projects[0], directory)
            target_store.current_config.tests[0].url = "/v3/login"

            target_store.save(sync_sharing=False)

            manifest = yaml.safe_load((Path(directory) / "beacon.yaml").read_text())
            endpoint_path = manifest["project"]["items"][0]["items"][0]["file"]
            endpoint = yaml.safe_load((Path(directory) / endpoint_path).read_text())
            self.assertEqual(endpoint["url"], "/v3/login")

    def test_open_existing_route_adds_and_switches_project(self):
        with tempfile.TemporaryDirectory() as directory:
            source = sample_project()
            ProjectFileSyncService().link(source, directory)
            shutil.rmtree(Path(directory) / ".beacon")
            existing = sample_project()
            existing["id"] = "other-project"
            target_store = Store(MemoryRepository({
                "current_project_id": existing["id"], "projects": [existing], "global_variables": {},
            }))
            target_store.load()
            app = FastAPI()
            app.include_router(router)

            with patch("backend.app.routers.projects.store", target_store):
                response = TestClient(app).post("/projects/file-sync/open", json={"path": directory})

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["project_id"], "project-1")
            self.assertEqual(response.json()["missing_private_values"][0]["key"], "access_token")
            self.assertEqual(target_store.current_project_id, "project-1")


if __name__ == "__main__":
    unittest.main()
