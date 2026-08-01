"""Contract for structured endpoint authorization.

Two defects motivated this module:

* Basic auth was emitted as the literal string `Basic {{username:password}}` —
  never base64-encoded, and referencing a variable name that cannot exist.
* The editor offered "inherit", stripped the Authorization header, and told the
  user auth was coming from the environment. No inheritance existed anywhere in
  the backend, so those requests went out unauthenticated.
"""
import base64
import unittest

from backend.app.core.auth import effective_auth, normalize_auth, resolve_auth_headers
from backend.app.core.models import EndpointTest, TestConfig
from backend.app.core.tester import APITester
from backend.app.state import Store
from backend.tests.helpers import MemoryRepository


def headers_for(endpoint, variables=None, inherited=None):
    config = TestConfig("https://api.test", variables or {})
    if inherited is not None:
        endpoint.inherited_auth = inherited
    return APITester(endpoint, config)._build_request()[1]


class BasicAuthTests(unittest.TestCase):
    def test_basic_credentials_are_base64_encoded(self):
        endpoint = EndpointTest("b", "B", "/x",
                                auth={"type": "basic", "username": "alice", "password": "s3cr3t"})
        header = headers_for(endpoint)["Authorization"]

        scheme, encoded = header.split(" ", 1)
        self.assertEqual(scheme, "Basic")
        self.assertEqual(base64.b64decode(encoded).decode(), "alice:s3cr3t")

    def test_basic_credentials_resolve_variables_before_encoding(self):
        endpoint = EndpointTest("b", "B", "/x",
                                auth={"type": "basic", "username": "{{user}}", "password": "{{pw}}"})
        header = headers_for(endpoint, {"user": "bob", "pw": "hunter2"})["Authorization"]

        # The whole point: credentials live in variables, never in the project
        # file, and are still encoded correctly on the wire.
        self.assertEqual(base64.b64decode(header.split(" ", 1)[1]).decode(), "bob:hunter2")

    def test_basic_never_emits_an_unencoded_placeholder(self):
        endpoint = EndpointTest("b", "B", "/x",
                                auth={"type": "basic", "username": "{{user}}", "password": "{{pw}}"})
        header = headers_for(endpoint, {"user": "a", "pw": "b"})["Authorization"]

        self.assertNotIn("{{", header)
        self.assertNotIn(":", header.split(" ", 1)[1])

    def test_basic_with_no_credentials_sends_nothing(self):
        endpoint = EndpointTest("b", "B", "/x", auth={"type": "basic"})
        self.assertNotIn("Authorization", headers_for(endpoint))

    def test_password_only_basic_is_still_encoded(self):
        endpoint = EndpointTest("b", "B", "/x", auth={"type": "basic", "password": "p"})
        header = headers_for(endpoint)["Authorization"]
        self.assertEqual(base64.b64decode(header.split(" ", 1)[1]).decode(), ":p")


class AuthTypeTests(unittest.TestCase):
    def test_bearer_token_is_resolved(self):
        endpoint = EndpointTest("t", "T", "/x", auth={"type": "bearer", "token": "{{access_token}}"})
        self.assertEqual(headers_for(endpoint, {"access_token": "abc"})["Authorization"],
                         "Bearer abc")

    def test_api_key_uses_its_configured_header(self):
        endpoint = EndpointTest("k", "K", "/x",
                                auth={"type": "apikey", "key": "X-Api-Key", "value": "{{api_key}}"})
        headers = headers_for(endpoint, {"api_key": "secret"})
        self.assertEqual(headers["X-Api-Key"], "secret")
        self.assertNotIn("Authorization", headers)

    def test_api_key_in_query_adds_no_header(self):
        endpoint = EndpointTest("k", "K", "/x",
                                auth={"type": "apikey", "in": "query", "key": "token", "value": "v"})
        self.assertEqual(headers_for(endpoint), {})

    def test_none_and_unset_send_no_authorization(self):
        for auth in ({"type": "none"}, None):
            with self.subTest(auth=auth):
                endpoint = EndpointTest("n", "N", "/x", auth=auth)
                self.assertNotIn("Authorization", headers_for(endpoint))

    def test_an_unknown_auth_type_is_ignored_rather_than_guessed(self):
        endpoint = EndpointTest("u", "U", "/x", auth={"type": "sorcery", "token": "x"})
        self.assertEqual(headers_for(endpoint), {})

    def test_auth_spec_overrides_a_stale_handwritten_header(self):
        endpoint = EndpointTest("o", "O", "/x",
                                headers={"Authorization": "Bearer leftover"},
                                auth={"type": "bearer", "token": "{{access_token}}"})
        self.assertEqual(headers_for(endpoint, {"access_token": "current"})["Authorization"],
                         "Bearer current")

    def test_endpoints_without_auth_keep_their_legacy_header(self):
        endpoint = EndpointTest("l", "L", "/x", headers={"Authorization": "Bearer {{access_token}}"})
        self.assertEqual(headers_for(endpoint, {"access_token": "tok"})["Authorization"],
                         "Bearer tok")


class InheritanceTests(unittest.TestCase):
    def test_inherit_resolves_the_enclosing_folder(self):
        endpoint = EndpointTest("i", "I", "/x", auth={"type": "inherit"})
        headers = headers_for(endpoint, {"access_token": "tok"},
                              inherited=[{"type": "bearer", "token": "{{access_token}}"}])
        self.assertEqual(headers["Authorization"], "Bearer tok")

    def test_the_innermost_folder_wins(self):
        endpoint = EndpointTest("i", "I", "/x", auth={"type": "inherit"})
        headers = headers_for(endpoint, {"a": "outer", "b": "inner"}, inherited=[
            {"type": "bearer", "token": "{{a}}"},
            {"type": "bearer", "token": "{{b}}"},
        ])
        self.assertEqual(headers["Authorization"], "Bearer inner")

    def test_the_endpoint_overrides_its_folder(self):
        endpoint = EndpointTest("i", "I", "/x", auth={"type": "bearer", "token": "{{own}}"})
        headers = headers_for(endpoint, {"own": "mine", "folder": "theirs"},
                              inherited=[{"type": "bearer", "token": "{{folder}}"}])
        self.assertEqual(headers["Authorization"], "Bearer mine")

    def test_explicit_none_opts_out_of_an_inherited_credential(self):
        endpoint = EndpointTest("i", "I", "/x", auth={"type": "none"})
        headers = headers_for(endpoint, {"t": "tok"},
                              inherited=[{"type": "bearer", "token": "{{t}}"}])
        # A public health check inside an authenticated folder must be able to
        # send no credential at all.
        self.assertNotIn("Authorization", headers)

    def test_inherit_with_nothing_to_inherit_sends_nothing(self):
        endpoint = EndpointTest("i", "I", "/x", auth={"type": "inherit"})
        self.assertNotIn("Authorization", headers_for(endpoint, inherited=[]))

    def test_effective_auth_skips_inherit_levels(self):
        resolved = effective_auth(
            {"type": "bearer", "token": "project"},
            {"type": "inherit"},
            {"type": "inherit"},
        )
        self.assertEqual(resolved["token"], "project")

    def test_normalize_rejects_malformed_specs(self):
        for value in (None, "bearer", {}, {"type": ""}, {"type": "nope"}):
            with self.subTest(value=value):
                self.assertIsNone(normalize_auth(value))

    def test_resolve_headers_tolerates_a_missing_spec(self):
        self.assertEqual(resolve_auth_headers(None, lambda value: value), {})


class StoreInheritanceTests(unittest.TestCase):
    """The chain must survive being flattened out of the project tree."""

    def _store(self, project):
        store = Store(repo=MemoryRepository({
            "projects": [project],
            "current_project_id": project["id"],
            "global_variables": {},
        }))
        store.projects = [project]
        store.current_project_id = project["id"]
        store.sync_current_config()
        return store

    def test_folder_auth_reaches_the_endpoint_inside_it(self):
        project = {
            "id": "p1", "name": "P",
            "environments": [{"id": "e1", "name": "Env", "base_url": "https://api.test",
                              "variables": {"access_token": "tok"}}],
            "current_environment_id": "e1",
            "items": [{
                "type": "folder", "id": "f1", "name": "Secure",
                "auth": {"type": "bearer", "token": "{{access_token}}"},
                "items": [{"type": "request", "id": "e1r", "name": "Inside",
                           "url": "/secure", "method": "GET", "auth": {"type": "inherit"}}],
            }],
        }
        store = self._store(project)
        endpoint = store.current_config.tests[0]

        self.assertEqual(endpoint.inherited_auth, [{"type": "bearer", "token": "{{access_token}}"}])
        headers = APITester(endpoint, store.current_config)._build_request()[1]
        self.assertEqual(headers["Authorization"], "Bearer tok")

    def test_project_auth_applies_when_no_folder_sets_one(self):
        project = {
            "id": "p1", "name": "P",
            "auth": {"type": "bearer", "token": "{{access_token}}"},
            "environments": [{"id": "e1", "name": "Env", "base_url": "https://api.test",
                              "variables": {"access_token": "ptok"}}],
            "current_environment_id": "e1",
            "items": [{"type": "request", "id": "r1", "name": "Root",
                       "url": "/x", "method": "GET", "auth": {"type": "inherit"}}],
        }
        store = self._store(project)
        headers = APITester(store.current_config.tests[0], store.current_config)._build_request()[1]
        self.assertEqual(headers["Authorization"], "Bearer ptok")

    def test_nested_folders_resolve_innermost_first(self):
        project = {
            "id": "p1", "name": "P",
            "auth": {"type": "bearer", "token": "{{project_token}}"},
            "environments": [{"id": "e1", "name": "Env", "base_url": "https://api.test",
                              "variables": {"project_token": "P", "team_token": "T"}}],
            "current_environment_id": "e1",
            "items": [{
                "type": "folder", "id": "f1", "name": "Outer", "items": [{
                    "type": "folder", "id": "f2", "name": "Inner",
                    "auth": {"type": "bearer", "token": "{{team_token}}"},
                    "items": [{"type": "request", "id": "r1", "name": "Deep",
                               "url": "/x", "method": "GET", "auth": {"type": "inherit"}}],
                }],
            }],
        }
        store = self._store(project)
        headers = APITester(store.current_config.tests[0], store.current_config)._build_request()[1]
        self.assertEqual(headers["Authorization"], "Bearer T")

    def test_the_runtime_chain_is_never_persisted(self):
        project = {
            "id": "p1", "name": "P",
            "environments": [{"id": "e1", "name": "Env", "base_url": "", "variables": {}}],
            "current_environment_id": "e1",
            "items": [{
                "type": "folder", "id": "f1", "name": "Secure",
                "auth": {"type": "bearer", "token": "{{access_token}}"},
                "items": [{"type": "request", "id": "r1", "name": "Inside",
                           "url": "/x", "method": "GET", "auth": {"type": "inherit"}}],
            }],
        }
        store = self._store(project)
        store.save_active_project()

        persisted = store.projects[0]["items"][0]["items"][0]
        self.assertNotIn("_inherited_auth", persisted)
        # The folder keeps its own auth; the endpoint keeps only its own spec.
        self.assertEqual(store.projects[0]["items"][0]["auth"],
                         {"type": "bearer", "token": "{{access_token}}"})
        self.assertEqual(persisted["auth"], {"type": "inherit"})


class BackwardCompatibilityTests(unittest.TestCase):
    def test_an_endpoint_without_auth_serializes_exactly_as_before(self):
        endpoint = EndpointTest.from_dict({"id": "a", "name": "A", "url": "/x"})
        self.assertNotIn("auth", endpoint.to_dict())

    def test_auth_round_trips_when_set(self):
        original = {"id": "a", "name": "A", "url": "/x",
                    "auth": {"type": "basic", "username": "u", "password": "p"}}
        restored = EndpointTest.from_dict(original)
        self.assertEqual(restored.to_dict()["auth"], original["auth"])
        self.assertEqual(EndpointTest.from_dict(restored.to_dict()).to_dict(), restored.to_dict())


if __name__ == "__main__":
    unittest.main()
