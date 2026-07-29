import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.app import mcp_server
from backend.app.core.models import EndpointTest, TestConfig


class MCPToolTests(unittest.TestCase):
    def setUp(self):
        self.folder = {"id": "folder-1", "name": "Auth", "type": "folder", "items": []}
        self.project = {
            "id": "project-1", "name": "Demo", "items": [self.folder],
            "environments": [{"id": "env-1", "name": "Local", "base_url": "https://api.test", "variables": {}}],
            "current_environment_id": "env-1",
        }
        self.endpoint = EndpointTest(
            "endpoint-1", "Profile", "/profile/{{user_id}}", "GET",
            {"Authorization": "secret-token", "X-Trace": "{{trace_id}}"},
        )
        self.saved = 0
        self.store = SimpleNamespace(
            projects=[self.project],
            current_project_id="project-1",
            current_config=TestConfig(
                "https://api.test", {"trace_id": "abc"}, [self.endpoint]
            ),
        )
        self.store.load = lambda: None
        self.store.save = self._save
        self.store.sync_current_config = self._sync

    def _save(self):
        self.saved += 1

    def _sync(self):
        tests = []

        def walk(items):
            for item in items:
                if item.get("type") == "folder":
                    walk(item.get("items", []))
                else:
                    tests.append(EndpointTest.from_dict(item))

        walk(self.project["items"])
        self.store.current_config.tests = tests

    def test_endpoint_discovery_is_paginated_and_searchable(self):
        self.store.current_config.tests.extend([
            EndpointTest("endpoint-2", "Login", "/login", "POST"),
            EndpointTest("endpoint-3", "Logout", "/logout", "POST"),
        ])
        with patch.object(mcp_server, "store", self.store):
            result = mcp_server.search_endpoints(query="log", limit=1)
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["items"]), 1)
        self.assertTrue(result["has_more"])

    def test_get_endpoint_redacts_secrets_and_reports_unresolved_variables(self):
        with patch.object(mcp_server, "store", self.store):
            result = mcp_server.get_endpoint("Profile")
        self.assertEqual(result["endpoint"]["headers"]["Authorization"], "[REDACTED]")
        self.assertEqual(result["endpoint"]["headers"]["X-Trace"], "{{trace_id}}")
        self.assertEqual(result["preflight"]["unresolved_variables"], ["user_id"])
        self.assertFalse(result["preflight"]["ready"])

    def test_create_endpoint_rejects_unknown_folder_instead_of_using_root(self):
        with patch.object(mcp_server, "store", self.store):
            result = mcp_server.create_endpoint("Users", "/users", folder_id="missing")
        self.assertEqual(result["error_code"], "folder_not_found")
        self.assertEqual(self.saved, 0)

    def test_import_collection_reuses_openapi_converter(self):
        source = {
            "openapi": "3.0.0",
            "info": {"title": "Pet API"},
            "servers": [{"url": "https://pets.test"}],
            "paths": {"/pets": {"get": {"summary": "List pets", "responses": {"200": {}}}}},
        }
        with patch.object(mcp_server, "store", self.store):
            result = mcp_server.import_collection(source, into_folder="Auth")
        self.assertTrue(result["ok"])
        self.assertEqual(result["format"], "openapi3")
        self.assertEqual(result["imported"], 1)
        self.assertEqual(self.folder["items"][0]["name"], "List pets")
        self.assertTrue(self.folder["items"][0]["id"])
        self.assertEqual(self.saved, 1)

    def test_curl_plain_text_becomes_raw_payload(self):
        with patch.object(mcp_server, "store", self.store):
            result = mcp_server.add_endpoint_from_curl(
                "curl https://api.test/events -d 'plain text'", name="Event"
            )
        created = self.store.current_config.tests[-1]
        self.assertEqual(result["name"], "Event")
        self.assertEqual(created.payload_type, "raw")
        self.assertEqual(created.payload, "plain text")

    def test_run_endpoint_rejects_zero_requests_before_network_access(self):
        with patch.object(mcp_server, "store", self.store):
            result = mcp_server.run_endpoint("Profile", count=0)
        self.assertEqual(result["error_code"], "invalid_argument")
        self.assertEqual(result["field"], "count")

    def test_send_request_caps_body_for_agent_context(self):
        calls = {}

        class FakeTester:
            def __init__(self, *args, **kwargs):
                pass

            def send_once(self, **kwargs):
                calls.update(kwargs)
                return {"ok": True, "status": 200, "body": "x" * kwargs["max_body"]}

        with (
            patch.object(mcp_server, "store", self.store),
            patch.object(mcp_server, "APITester", FakeTester),
        ):
            result = mcp_server.send_request("Profile")
        self.assertEqual(calls["max_body"], 20_000)
        self.assertEqual(len(result["body"]), 20_000)


if __name__ == "__main__":
    unittest.main()
