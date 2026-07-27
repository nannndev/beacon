import os
import tempfile
import threading
import time
import unittest

from backend.app.sharing import SqliteSharedProjectRepository
from backend.app.sharing.service import SharedProjectService


def source():
    return {
        "id": "p1", "name": "LAN project",
        "environments": [{"id": "env1", "name": "Local", "variables": {}}],
        "items": [{
            "id": "e1", "type": "request", "name": "Before",
            "url": "https://example.com", "method": "GET", "headers": {}, "payload": {},
        }],
    }


class RealLanSharingLifecycleTests(unittest.TestCase):
    """Exercises the real Uvicorn LAN transport instead of TestClient/mocks."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.owner_project = source()
        self.owner = SharedProjectService(
            SqliteSharedProjectRepository(os.path.join(self.tmp.name, "owner.db")),
            lambda project_id: self.owner_project if project_id == "p1" else None,
            lambda: "owner-device",
        )
        self.member = SharedProjectService(
            SqliteSharedProjectRepository(os.path.join(self.tmp.name, "member.db")),
            lambda _project_id: None, lambda: "member-device",
        )
        self.member2 = SharedProjectService(
            SqliteSharedProjectRepository(os.path.join(self.tmp.name, "member2.db")),
            lambda _project_id: None, lambda: "member-device-2",
        )
        self.owner.initialize()
        self.member.initialize()
        self.member2.initialize()
        self.owner.repository.import_project(self.owner_project, "owner-device")
        self.owner.repository.set_sharing_enabled("p1", True)
        self.owner.lan_host.start("p1", "LAN project")
        self.address = f"127.0.0.1:{self.owner.lan_host._port}"
        deadline = time.time() + 3
        while time.time() < deadline:
            try:
                self.member.request_join(self.address, self.owner.lan_host._pairing_code, "Member laptop")
                break
            except Exception:
                time.sleep(0.03)
        else:
            self.fail("LAN host did not start")

    def tearDown(self):
        self.owner.lan_host.stop()
        self.tmp.cleanup()

    def _join(self, role="editor", service=None, name="Member laptop"):
        service = service or self.member
        pending = service.request_join(self.address, self.owner.lan_host._pairing_code, name)
        self.owner.decide_pairing("p1", pending["request_id"], True, role)
        approved = service.complete_join(self.address, pending["request_id"])
        self.assertEqual(approved["status"], "approved")
        return approved["project"]

    def test_pair_edit_live_event_and_host_shutdown(self):
        joined = self._join("editor")
        self.assertEqual(joined["shared_origin"]["role"], "editor")
        original_session_token = joined["shared_origin"]["session_token"]
        connected = self.owner.lan_host.status()["connected_members"][0]
        self.assertEqual(connected["protocol"], 2)
        self.assertIn("trusted_reconnect", connected["capabilities"])

        joined["items"][0]["name"] = "Changed by member"
        self.assertTrue(self.member.push_if_joined(joined))
        self.assertEqual(self.owner.snapshot("p1")["source"]["items"][0]["name"], "Changed by member")

        # Begin an actual long-lived event wait, then mutate on the owner. The
        # condition notification should wake the member well before timeout.
        canonical = self.owner.pull_updates(self.owner_project)
        self.owner_project.clear()
        self.owner_project.update(canonical)
        result = {}
        waiter = threading.Thread(
            target=lambda: result.update(project=self.member.watch_updates(joined, timeout=3)),
            daemon=True,
        )
        waiter.start()
        time.sleep(0.1)
        self.owner_project["name"] = "Renamed live"
        self.assertTrue(self.owner.record_local_change(self.owner_project))
        waiter.join(timeout=2)
        self.assertFalse(waiter.is_alive())
        self.assertEqual(result["project"]["name"], "Renamed live")

        self.owner.lan_host.stop()
        self.assertIsNone(self.member.watch_updates(result["project"], timeout=0.1))
        origin = result["project"]["shared_origin"]
        self.assertEqual(origin["connection_state"], "host_offline")
        self.assertIsNotNone(origin["offline_since"])

        # The host comes back on its stable project-sharing port. Its in-memory
        # session is gone, but the per-device trust record creates a fresh one.
        self.owner.lan_host.start("p1", "LAN project")
        restarted_address = f"127.0.0.1:{self.owner.lan_host._port}"
        self.assertEqual(restarted_address, self.address)
        reconnected = self.member.watch_updates(result["project"], timeout=0.2)
        self.assertIsNotNone(reconnected)
        self.assertEqual(reconnected["shared_origin"]["connection_state"], "connected")
        self.assertNotEqual(reconnected["shared_origin"]["session_token"], original_session_token)

    def test_two_real_editors_create_and_resolve_same_field_conflict(self):
        first = self._join("editor", self.member, "Editor one")
        second = self._join("editor", self.member2, "Editor two")

        first["items"][0]["name"] = "First editor value"
        self.assertTrue(self.member.push_if_joined(first))

        second["items"][0]["name"] = "Second editor value"
        self.assertFalse(self.member2.push_if_joined(second))
        conflict = second["shared_origin"]["conflict"]
        self.assertEqual(second["shared_origin"]["connection_state"], "conflict")
        self.assertEqual(conflict["fields"][0]["label"], "items.e1.name")

        resolved = self.member2.resolve_conflict(second, "team")
        self.assertEqual(resolved["items"][0]["name"], "First editor value")
        self.assertEqual(resolved["shared_origin"]["connection_state"], "connected")

    def test_trusted_device_role_and_revoke_survive_without_live_session(self):
        joined = self._join("viewer")
        self.assertTrue(joined["shared_origin"]["trusted_credential"])
        trusted = self.owner.repository.trusted_devices("p1")
        self.assertEqual(trusted[0]["device_id"], "member-device")
        self.assertEqual(trusted[0]["role"], "viewer")

        self.owner.lan_host._sessions.clear()
        changed = self.owner.update_member("p1", "member-device", "editor")
        self.assertFalse(changed["connected"])
        self.assertEqual(self.owner.repository.trusted_device("p1", "member-device")["role"], "editor")
        removed = self.owner.remove_member("p1", "member-device")
        self.assertTrue(removed["removed"])
        self.assertIsNone(self.owner.repository.trusted_device("p1", "member-device"))

    def test_trusted_member_rediscovers_changed_host_address(self):
        joined = self._join("viewer")
        joined["shared_origin"]["host_address"] = "192.0.2.10:59999"

        discovered = self.member.discover_host(joined, timeout=1.0)

        self.assertIsNotNone(discovered)
        self.assertEqual(discovered["project_id"], "p1")
        self.assertNotEqual(joined["shared_origin"]["host_address"], "192.0.2.10:59999")
        self.assertTrue(joined["shared_origin"]["host_address"].endswith(f":{self.owner.lan_host._port}"))

    def test_wrong_pinned_fingerprint_blocks_request_on_actual_tls_connection(self):
        joined = self._join("editor")
        joined["items"][0]["name"] = "Must never reach host"
        joined["shared_origin"]["certificate_fingerprint"] = "00" * 32

        self.assertFalse(self.member.push_if_joined(joined))
        self.assertEqual(joined["shared_origin"]["connection_state"], "identity_changed")
        self.assertEqual(self.owner.snapshot("p1")["source"]["items"][0]["name"], "Before")


if __name__ == "__main__":
    unittest.main()
