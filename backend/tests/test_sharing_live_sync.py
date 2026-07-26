import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from backend.app.sharing import SqliteSharedProjectRepository
from backend.app.sharing.service import SharedProjectService


def project_source():
    return {
        "id": "p1",
        "name": "Demo",
        "notifications": {"discord_webhook": "https://secret.invalid"},
        "environments": [{
            "id": "env1",
            "variables": {"base_url": "https://api.example.com", "access_token": "secret"},
        }],
        "items": [{"id": "e1", "type": "request", "name": "Before"}],
    }


class SharingLiveSyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.project = project_source()
        repo = SqliteSharedProjectRepository(os.path.join(self.tmp.name, "workspace.db"))
        self.service = SharedProjectService(
            repo,
            lambda project_id: self.project if project_id == "p1" else None,
            lambda: "owner-device",
        )
        self.service.initialize()
        self.service.repository.import_project(self.project, "owner-device")
        self.service.repository.set_sharing_enabled("p1", True)

    def tearDown(self):
        self.tmp.cleanup()

    def _client(self, role):
        host = self.service.lan_host
        host._project_id = "p1"
        host._project_name = "Demo"
        host._sessions["session-token"] = {
            "device_id": "member-device", "device_name": "Member", "role": role,
        }
        return TestClient(host._app())

    def test_editor_mutation_is_revisioned_and_never_exposes_local_secrets(self):
        client = self._client("editor")
        response = client.post(
            "/beacon-share/projects/p1/mutations",
            headers={"Authorization": "Bearer session-token"},
            json={
                "mutation_id": "m1", "base_revision": 1,
                "operation": "endpoint.updated", "target_id": "e1",
                "payload": {"name": "After"},
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["revision"], 2)

        snapshot = client.get(
            "/beacon-share/projects/p1/snapshot",
            headers={"Authorization": "Bearer session-token"},
        ).json()
        self.assertEqual(snapshot["source"]["items"][0]["name"], "After")
        self.assertIsNone(snapshot["source"]["environments"][0]["variables"]["access_token"]["value"])
        self.assertNotIn("notifications", snapshot["source"])

    def test_viewer_cannot_mutate_project_source(self):
        client = self._client("viewer")
        response = client.post(
            "/beacon-share/projects/p1/mutations",
            headers={"Authorization": "Bearer session-token"},
            json={"mutation_id": "m1", "base_revision": 1, "operation": "project.updated", "payload": {}},
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_can_change_role_and_revoke_member(self):
        self._client("viewer")
        changed = self.service.update_member("p1", "member-device", "editor")
        self.assertEqual(changed["role"], "editor")
        self.assertEqual(self.service.lan_host.status()["connected_members"][0]["role"], "editor")

        removed = self.service.remove_member("p1", "member-device")
        self.assertTrue(removed["removed"])
        self.assertEqual(self.service.lan_host.status()["connected_members"], [])

    def test_joined_editor_pushes_full_source_and_updates_revision(self):
        member = project_source()
        member["name"] = "Renamed by editor"
        member["shared_origin"] = {
            "host_address": "192.168.1.5:4123", "session_token": "token",
            "role": "editor", "revision": 1,
        }
        remote_snapshot = Mock()
        remote_snapshot.json.return_value = self.service.snapshot("p1")
        remote_snapshot.raise_for_status.return_value = None
        mutation_response = Mock()
        mutation_response.json.return_value = {"revision": 2}
        mutation_response.raise_for_status.return_value = None

        with patch("backend.app.sharing.service.requests.get", return_value=remote_snapshot), patch(
            "backend.app.sharing.service.requests.post", return_value=mutation_response
        ) as post:
            changed = self.service.push_if_joined(member)

        self.assertTrue(changed)
        self.assertEqual(member["shared_origin"]["revision"], 2)
        sent = post.call_args.kwargs["json"]["payload"]
        self.assertEqual(sent["name"], "Renamed by editor")
        self.assertNotIn("shared_origin", sent)
        self.assertNotIn("notifications", sent)


if __name__ == "__main__":
    unittest.main()
