import os
import tempfile
import unittest

from backend.app.sharing import Mutation, MutationConflict, SqliteSharedProjectRepository


def project_source():
    return {
        "id": "project-1",
        "name": "Platform API",
        "environments": [{
            "id": "env-1",
            "name": "Staging",
            "variables": {
                "base_url": "https://staging.example.com",
                "access_token": "do-not-share",
            },
        }],
        "items": [{
            "id": "endpoint-1", "type": "request", "name": "List users",
            "method": "GET", "url": "/users",
        }],
    }


class SharedProjectRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = SqliteSharedProjectRepository(os.path.join(self.tmp.name, "workspace.db"))
        self.repo.initialize()

    def tearDown(self):
        self.tmp.cleanup()

    def test_import_creates_revision_one_and_redacts_secrets(self):
        result = self.repo.import_project(project_source(), "device-owner")
        self.assertEqual(result["revision"], 1)
        variables = result["source"]["environments"][0]["variables"]
        self.assertEqual(variables["base_url"]["scope"], "shared")
        self.assertEqual(variables["base_url"]["value"], "https://staging.example.com")
        self.assertEqual(variables["access_token"], {"key": "access_token", "scope": "private", "value": None})
        self.assertEqual(self.repo.revisions_after("project-1", 0)[0].operation, "project.imported")

    def test_mutation_is_atomic_revisioned_and_idempotent(self):
        self.repo.import_project(project_source(), "device-owner")
        mutation = Mutation("mutation-1", "project-1", 1, "endpoint.updated", "endpoint-1", {"name": "All users"})
        first = self.repo.apply_mutation(mutation, "device-editor", "Renamed endpoint")
        second = self.repo.apply_mutation(mutation, "device-editor", "Retried")
        self.assertEqual(first.id, second.id)
        self.assertEqual(first.revision, 2)
        self.assertEqual(self.repo.snapshot("project-1")["source"]["items"][0]["name"], "All users")
        self.assertEqual(len(self.repo.revisions_after("project-1", 0)), 2)

    def test_stale_mutation_returns_structured_conflict(self):
        self.repo.import_project(project_source(), "device-owner")
        self.repo.apply_mutation(
            Mutation("m1", "project-1", 1, "endpoint.updated", "endpoint-1", {"name": "First"}),
            "device-a", "First edit",
        )
        with self.assertRaises(MutationConflict) as caught:
            self.repo.apply_mutation(
                Mutation("m2", "project-1", 1, "endpoint.updated", "endpoint-1", {"name": "Stale"}),
                "device-b", "Stale edit",
            )
        self.assertEqual(caught.exception.to_dict()["current_revision"], 2)
        self.assertEqual(caught.exception.to_dict()["latest_entity"]["name"], "First")

    def test_sqlite_safety_pragmas(self):
        self.assertEqual(self.repo.pragma("journal_mode").lower(), "wal")
        self.assertEqual(int(self.repo.pragma("foreign_keys")), 1)
        self.assertEqual(int(self.repo.pragma("busy_timeout")), 5000)


if __name__ == "__main__":
    unittest.main()
