import unittest

from backend.app.routers.projects import ensure_jsonplaceholder_project
from backend.app.state import Store
from backend.tests.helpers import MemoryRepository, flatten_requests


class SampleProjectFlowTests(unittest.TestCase):
    def test_missing_storage_seeds_default_sample(self):
        target = Store(MemoryRepository(None))

        target.load()

        self.assertEqual(len(target.projects), 1)
        self.assertEqual(target.projects[0]["name"], "Default Project")
        self.assertEqual(target.projects[0]["template_id"], "jsonplaceholder-v1")
        self.assertEqual(len(flatten_requests(target.projects[0]["items"])), 47)

    def test_existing_empty_project_is_not_replaced(self):
        data = {
            "current_project_id": "p1",
            "projects": [
                {
                    "id": "p1",
                    "name": "Mine",
                    "environments": [],
                    "items": [],
                }
            ],
            "global_variables": {},
        }
        target = Store(MemoryRepository(data))

        target.load()

        self.assertEqual(len(target.projects), 1)
        self.assertNotIn("template_id", target.projects[0])

    def test_ensure_sample_is_idempotent_and_switches_to_existing_sample(self):
        data = {
            "current_project_id": "p1",
            "projects": [
                {
                    "id": "p1",
                    "name": "Mine",
                    "environments": [],
                    "items": [],
                }
            ],
            "global_variables": {},
        }
        target = Store(MemoryRepository(data))
        target.load()

        first, created_first = ensure_jsonplaceholder_project(target, "JSONPlaceholder API")
        target.current_project_id = "p1"
        second, created_second = ensure_jsonplaceholder_project(target, "Different Name")

        self.assertEqual(first["id"], second["id"])
        self.assertTrue(created_first)
        self.assertFalse(created_second)
        self.assertEqual(target.current_project_id, first["id"])
        self.assertEqual(len(target.projects), 2)


if __name__ == "__main__":
    unittest.main()
