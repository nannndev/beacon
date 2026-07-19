import unittest

from backend.app.catalogs.jsonplaceholder import (
    JSONPLACEHOLDER_TEMPLATE_ID,
    build_jsonplaceholder_project,
)
from backend.tests.helpers import flatten_requests


class JsonPlaceholderCatalogTests(unittest.TestCase):
    def test_catalog_has_47_unique_requests_and_expected_tree(self):
        project = build_jsonplaceholder_project()
        requests = flatten_requests(project["items"])

        self.assertEqual(JSONPLACEHOLDER_TEMPLATE_ID, "jsonplaceholder-v1")
        self.assertEqual(project["template_id"], JSONPLACEHOLDER_TEMPLATE_ID)
        self.assertEqual(len(requests), 47)
        self.assertEqual(len({request["id"] for request in requests}), 47)
        self.assertEqual(
            [folder["name"] for folder in project["items"]],
            ["Posts", "Comments", "Albums", "Photos", "Todos", "Users"],
        )
        for folder in project["items"]:
            self.assertEqual(
                [group["name"] for group in folder["items"][:2]],
                ["Read", "Write"],
            )

    def test_catalog_ids_are_stable_and_defaults_are_safe(self):
        first = build_jsonplaceholder_project()
        second = build_jsonplaceholder_project()

        self.assertNotEqual(first["id"], second["id"])
        self.assertNotEqual(
            first["environments"][0]["id"], second["environments"][0]["id"]
        )
        self.assertEqual(
            [request["id"] for request in flatten_requests(first["items"])],
            [request["id"] for request in flatten_requests(second["items"])],
        )
        self.assertEqual(
            first["environments"][0]["base_url"],
            "https://jsonplaceholder.typicode.com",
        )
        self.assertEqual(first["environments"][0]["variables"]["user_id"], 1)
        for request in flatten_requests(first["items"]):
            self.assertEqual(
                request["run_config"],
                {
                    "concurrency": 1,
                    "max_requests": 10,
                    "delay": 0.5,
                    "use_min_delay": False,
                },
            )
            expected_status = 201 if request["method"] == "POST" else 200
            self.assertEqual(request["assertions"][0]["value"], expected_status)

    def test_delete_requests_avoid_body_assertions(self):
        deletes = [
            request
            for request in flatten_requests(build_jsonplaceholder_project()["items"])
            if request["method"] == "DELETE"
        ]

        self.assertEqual(len(deletes), 6)
        for request in deletes:
            self.assertEqual(
                [assertion["type"] for assertion in request["assertions"]],
                ["status", "time_ms"],
            )


if __name__ == "__main__":
    unittest.main()
