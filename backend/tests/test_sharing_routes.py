import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.app.routers import sharing
from backend.app.sharing import SqliteSharedProjectRepository
from backend.app.sharing.service import SharedProjectService


class SharingRouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        repo = SqliteSharedProjectRepository(os.path.join(self.tmp.name, "workspace.db"))
        project = {
            "id": "p1", "name": "Demo",
            "environments": [{"id": "env1", "variables": {"api_key": "secret"}}],
            "items": [{"id": "e1", "type": "request", "name": "Before"}],
        }
        service = SharedProjectService(repo, lambda pid: project if pid == "p1" else None, lambda: "device-1")
        service.initialize()
        self.fake_store = SimpleNamespace(sharing=service)

    def tearDown(self):
        self.tmp.cleanup()

    def test_enable_status_snapshot_and_disable(self):
        with patch.object(sharing, "store", self.fake_store):
            enabled = sharing.enable_sharing("p1")
            self.assertTrue(enabled["sharing_enabled"])
            snapshot = sharing.project_snapshot("p1")
            self.assertIsNone(snapshot["source"]["environments"][0]["variables"]["api_key"]["value"])
            disabled = sharing.disable_sharing("p1")
            self.assertFalse(disabled["sharing_enabled"])

    def test_mutation_and_conflict_are_exposed(self):
        with patch.object(sharing, "store", self.fake_store):
            sharing.enable_sharing("p1")
            result = sharing.apply_mutation("p1", {
                "mutation_id": "m1", "base_revision": 1,
                "operation": "endpoint.updated", "target_id": "e1",
                "payload": {"name": "After"},
            })
            self.assertEqual(result["revision"], 2)
            with self.assertRaises(HTTPException) as caught:
                sharing.apply_mutation("p1", {
                    "mutation_id": "m2", "base_revision": 1,
                    "operation": "endpoint.updated", "target_id": "e1",
                    "payload": {"name": "Stale"},
                })
            self.assertEqual(caught.exception.status_code, 409)

    def test_unknown_project_is_not_shared(self):
        with patch.object(sharing, "store", self.fake_store):
            status = sharing.sharing_status("missing")
        self.assertFalse(status["sharing_enabled"])


if __name__ == "__main__":
    unittest.main()
