import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.app.history.models import RunMetrics, RunStart
from backend.app.history.service import HistoryService
from backend.app.history.sqlite_repository import SqliteRunHistoryRepository
from backend.app.routers import history


class HistoryRouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        repository = SqliteRunHistoryRepository(os.path.join(self.tmp.name, "history.db"))
        self.service = HistoryService(repository)
        self.service.initialize()
        for run_id, target in (("r1", "List posts"), ("r2", "Create post")):
            self.service.start(
                RunStart(
                    id=run_id,
                    workspace_id=self.service.workspace_id,
                    project_id="p1",
                    project_name="Demo",
                    origin_device_id=self.service.origin_device_id,
                    source_type="endpoint",
                    target_id="e1",
                    target_name=target,
                    mode="load",
                    config_snapshot={"mode": "load"},
                ),
                [],
            )
            self.service.finish_run(run_id, "completed")
        self.fake_store = SimpleNamespace(history=self.service)

    def tearDown(self):
        self.tmp.cleanup()

    def test_list_applies_limit_and_filters(self):
        with patch.object(history, "store", self.fake_store):
            response = history.list_history(
                project_id="p1",
                mode="load",
                status="completed",
                source_type=None,
                pinned=False,
                date_from=None,
                date_to=None,
                search="posts",
                cursor=None,
                limit=30,
            )
        self.assertEqual(response["items"][0]["project_id"], "p1")

    def test_compare_requires_distinct_existing_runs(self):
        with patch.object(history, "store", self.fake_store):
            with self.assertRaises(HTTPException) as error:
                history.compare_history({"baseline_id": "r1", "candidate_id": "r1"})
        self.assertEqual(error.exception.status_code, 400)

    def test_export_is_allowlisted(self):
        with patch.object(history, "store", self.fake_store):
            exported = history.export_history("r1")
        serialized = json.dumps(exported).lower()
        self.assertEqual(exported["format"], "beacon.run-history")
        self.assertNotIn("headers", serialized)
        self.assertNotIn("body", serialized)

    def test_rebuild_requires_exact_confirmation(self):
        with patch.object(history, "store", self.fake_store):
            with self.assertRaises(HTTPException) as error:
                history.rebuild_history({"confirm": "yes"})
        self.assertEqual(error.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
