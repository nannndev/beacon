import os
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import requests
from fastapi.testclient import TestClient

from backend.app.sharing import SqliteSharedProjectRepository
from backend.app.sharing.service import SharedProjectService, _three_way_merge


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
        self.fingerprint_patch = patch(
            "backend.app.sharing.service.remote_fingerprint", return_value="aa" * 32
        )
        self.fingerprint_patch.start()
        # Keep unit tests focused on sharing behavior while production uses a
        # fingerprint-pinned Session for the actual HTTPS connection.
        class RequestProxy:
            def get(self, *args, **kwargs):
                return requests.get(*args, **kwargs)

            def post(self, *args, **kwargs):
                return requests.post(*args, **kwargs)

        self.session_patch = patch(
            "backend.app.sharing.service.pinned_session", side_effect=lambda _fingerprint: RequestProxy()
        )
        self.session_patch.start()

    def tearDown(self):
        self.session_patch.stop()
        self.fingerprint_patch.stop()
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
        self.assertEqual(response.json()["actor_device_name"], "Member")

        snapshot = client.get(
            "/beacon-share/projects/p1/snapshot",
            headers={"Authorization": "Bearer session-token"},
        ).json()
        self.assertEqual(snapshot["source"]["items"][0]["name"], "After")
        self.assertIsNone(snapshot["source"]["environments"][0]["variables"]["access_token"]["value"])
        self.assertNotIn("notifications", snapshot["source"])

    def test_pairing_captures_member_ip_automatically(self):
        host = self.service.lan_host
        host._project_id = "p1"
        host._project_name = "Demo"
        host._pairing_code = "123456"
        host._pairing_expires_at = 9_999_999_999
        response = TestClient(host._app()).post("/beacon-share/pair", json={
            "project_id": "p1", "code": "123456",
            "device_id": "member-device", "device_name": "Member",
        })
        self.assertEqual(response.status_code, 200)
        request = next(iter(host._pending.values()))
        self.assertEqual(request["device_ip"], "testclient")

    def test_join_rejects_incompatible_host_before_pairing(self):
        info = Mock()
        info.json.return_value = {"project_id": "p1", "protocol": 1, "min_protocol": 1}
        info.raise_for_status.return_value = None
        with patch("backend.app.sharing.service.requests.get", return_value=info), patch(
            "backend.app.sharing.service.requests.post"
        ) as post, self.assertRaisesRegex(ValueError, "Update required"):
            self.service.request_join("192.168.1.5:47821", "123456", "Old host")
        post.assert_not_called()

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

    def test_host_presence_marks_stale_member_offline(self):
        self._client("viewer")
        member = next(iter(self.service.lan_host._sessions.values()))
        member["last_seen"] = time.time() - 10
        status = self.service.lan_host.status()
        self.assertEqual(status["connected_members"][0]["connection_state"], "offline")

    def test_revision_event_channel_returns_immediately_when_revision_exists(self):
        client = self._client("viewer")
        response = client.get(
            "/beacon-share/projects/p1/events?after=0&timeout=5&active_target_id=e1&active_target_name=List%20posts&activity=viewing",
            headers={"Authorization": "Bearer session-token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["timed_out"])
        self.assertEqual(response.json()["items"][0]["revision"], 1)
        member = self.service.lan_host.status()["connected_members"][0]
        self.assertEqual(member["active_target_id"], "e1")
        self.assertEqual(member["active_target_name"], "List posts")
        self.assertEqual(member["activity"], "viewing")

    def test_member_keeps_snapshot_and_offline_metadata_when_host_stops(self):
        member = project_source()
        member["shared_origin"] = {
            "host_address": "192.168.1.5:4123", "session_token": "token",
            "certificate_fingerprint": "aa" * 32,
            "role": "viewer", "revision": 1,
        }
        with patch("backend.app.sharing.service.requests.get", side_effect=requests.ConnectionError("host down")):
            updated = self.service.pull_if_joined(member)
        self.assertIsNone(updated)
        origin = member["shared_origin"]
        self.assertEqual(origin["connection_state"], "host_offline")
        self.assertIsNotNone(origin["offline_since"])
        self.assertEqual(origin["retry_count"], 1)

    def test_member_blocks_changed_host_certificate_before_sending_source(self):
        member = project_source()
        member["name"] = "Sensitive local edit"
        member["shared_origin"] = {
            "host_address": "192.168.1.5:4123", "session_token": "token",
            "certificate_fingerprint": "aa" * 32,
            "role": "editor", "revision": 1,
        }
        failed_session = Mock()
        failed_session.get.side_effect = requests.exceptions.SSLError("fingerprint mismatch")
        with patch("backend.app.sharing.service.pinned_session", return_value=failed_session):
            changed = self.service.push_if_joined(member)
        self.assertFalse(changed)
        self.assertEqual(member["shared_origin"]["connection_state"], "identity_changed")
        failed_session.post.assert_not_called()

    def test_joined_editor_pushes_full_source_and_updates_revision(self):
        member = project_source()
        member["name"] = "Renamed by editor"
        member["shared_origin"] = {
            "host_address": "192.168.1.5:4123", "session_token": "token",
            "certificate_fingerprint": "aa" * 32,
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

    def test_joined_editor_keeps_both_sources_on_revision_conflict(self):
        member = project_source()
        member["name"] = "Local name"
        member["shared_origin"] = {
            "host_address": "192.168.1.5:4123", "session_token": "token",
            "certificate_fingerprint": "aa" * 32,
            "role": "editor", "revision": 1,
        }
        team = project_source()
        team["name"] = "Team name"
        remote_snapshot = Mock(status_code=200)
        remote_snapshot.json.return_value = self.service.snapshot("p1")
        remote_snapshot.raise_for_status.return_value = None
        conflict_response = Mock(status_code=409)
        conflict_response.json.return_value = {"detail": {
            "current_revision": 2, "latest_entity": team,
        }}

        with patch("backend.app.sharing.service.requests.get", return_value=remote_snapshot), patch(
            "backend.app.sharing.service.requests.post", return_value=conflict_response
        ):
            changed = self.service.push_if_joined(member)

        self.assertFalse(changed)
        self.assertEqual(member["shared_origin"]["connection_state"], "conflict")
        self.assertEqual(member["shared_origin"]["conflict"]["local_source"]["name"], "Local name")
        self.assertEqual(member["shared_origin"]["conflict"]["team_source"]["name"], "Team name")

        resolved = self.service.resolve_conflict(member, "team")
        self.assertEqual(resolved["name"], "Team name")
        self.assertEqual(resolved["shared_origin"]["revision"], 2)
        self.assertIsNone(resolved["shared_origin"]["conflict"])

    def test_three_way_merge_combines_non_overlapping_source_edits(self):
        base = project_source()
        team = project_source()
        team["items"][0]["name"] = "Changed by team"
        mine = project_source()
        mine["name"] = "Changed locally"

        merged, conflicts = _three_way_merge(base, team, mine)

        self.assertEqual(conflicts, [])
        self.assertEqual(merged["name"], "Changed locally")
        self.assertEqual(merged["items"][0]["name"], "Changed by team")

    def test_three_way_merge_reports_same_field_edits(self):
        base = project_source()
        team = project_source()
        team["items"][0]["name"] = "Team"
        mine = project_source()
        mine["items"][0]["name"] = "Mine"

        merged, conflicts = _three_way_merge(base, team, mine)

        self.assertEqual(merged["items"][0]["name"], "Mine")
        self.assertEqual(conflicts[0]["label"], "items.e1.name")
        self.assertEqual(conflicts[0]["team_value"], "Team")
        self.assertEqual(conflicts[0]["local_value"], "Mine")

    def test_non_overlapping_remote_conflict_is_merged_automatically(self):
        base = project_source()
        member = project_source()
        member["name"] = "Local project name"
        member["shared_origin"] = {
            "host_address": "192.168.1.5:4123", "session_token": "token",
            "certificate_fingerprint": "aa" * 32,
            "role": "editor", "revision": 1, "last_synced_source": base,
        }
        team = project_source()
        team["items"][0]["name"] = "Team endpoint name"
        remote_snapshot = Mock(status_code=200)
        remote_snapshot.json.return_value = {"revision": 2, "source": team}
        remote_snapshot.raise_for_status.return_value = None
        conflict_response = Mock(status_code=409)
        conflict_response.json.return_value = {"detail": {
            "current_revision": 2, "latest_entity": team,
        }}
        merged_response = Mock(status_code=200)
        merged_response.json.return_value = {"revision": 3}
        merged_response.raise_for_status.return_value = None

        with patch("backend.app.sharing.service.requests.get", return_value=remote_snapshot), patch(
            "backend.app.sharing.service.requests.post", side_effect=[conflict_response, merged_response]
        ):
            changed = self.service.push_if_joined(member)

        self.assertTrue(changed)
        self.assertEqual(member["name"], "Local project name")
        self.assertEqual(member["items"][0]["name"], "Team endpoint name")
        self.assertEqual(member["shared_origin"]["revision"], 3)
        self.assertEqual(member["shared_origin"]["connection_state"], "connected")


if __name__ == "__main__":
    unittest.main()
