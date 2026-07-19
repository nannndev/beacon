import os
import tempfile
import unittest

from backend.app.history.models import (
    RunEvent,
    RunMetrics,
    RunSample,
    RunStart,
    RunStepStart,
)
from backend.app.history.sqlite_repository import SqliteRunHistoryRepository


def make_run(run_id: str, project_id: str = "p1", pinned: bool = False) -> RunStart:
    return RunStart(
        id=run_id,
        workspace_id="w1",
        project_id=project_id,
        project_name="Demo",
        origin_device_id="d1",
        source_type="endpoint",
        target_id="e1",
        target_name=f"Run {run_id}",
        mode="load",
        config_snapshot={"concurrency": 1},
        is_pinned=pinned,
    )


class HistoryRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "history.db")
        self.repo = SqliteRunHistoryRepository(self.path)
        self.repo.initialize()

    def tearDown(self):
        self.tmp.cleanup()

    def test_schema_settings_and_round_trip(self):
        self.assertEqual(self.repo.pragma("journal_mode").lower(), "wal")
        self.assertEqual(int(self.repo.pragma("foreign_keys")), 1)
        self.assertEqual(int(self.repo.pragma("busy_timeout")), 5000)

        self.repo.create_run(
            make_run("r1"),
            [RunStepStart(0, "e1", "List posts", "GET", "/posts")],
        )
        self.repo.finalize_step(
            "r1", 0, "completed", RunMetrics(attempts=10, success=10, p95_ms=42)
        )
        self.repo.finalize_run(
            "r1",
            "completed",
            RunMetrics(attempts=10, success=10, p95_ms=42),
            [RunSample(0, 1000, 10, 10, 0, 0, 10.0, 42.0)],
            [RunEvent(500, "success", 200, 42.0, None)],
        )

        detail = self.repo.get_run("r1")
        self.assertEqual(detail["metrics"]["attempts"], 10)
        self.assertEqual(detail["steps"][0]["url_template"], "/posts")
        self.assertEqual(detail["samples"][0]["instantaneous_rps"], 10.0)
        self.assertEqual(detail["events"][0]["status_code"], 200)

    def test_list_filters_cursor_update_and_delete(self):
        for index in range(3):
            self.repo.create_run(make_run(f"r{index}"), [])
            self.repo.finalize_run(f"r{index}", "completed", RunMetrics(success=index))

        first = self.repo.list_runs({"project_id": "p1", "search": "Run"}, None, 2)
        self.assertEqual(len(first["items"]), 2)
        self.assertIsNotNone(first["next_cursor"])
        second = self.repo.list_runs(
            {"project_id": "p1"}, first["next_cursor"], 2
        )
        self.assertEqual(len(second["items"]), 1)

        self.repo.update_run("r0", label="Release candidate", is_pinned=True)
        self.assertEqual(self.repo.get_run("r0")["label"], "Release candidate")
        self.assertTrue(self.repo.get_run("r0")["is_pinned"])
        self.repo.delete_run("r0")
        self.assertIsNone(self.repo.get_run("r0"))

    def test_retention_keeps_100_unpinned_plus_pins(self):
        for index in range(105):
            self.repo.create_run(make_run(f"u{index}"), [])
        for index in range(2):
            self.repo.create_run(make_run(f"pin{index}", pinned=True), [])

        self.repo.enforce_retention("p1")

        rows = self.repo.list_runs({"project_id": "p1"}, None, 200)["items"]
        self.assertEqual(len(rows), 102)
        self.assertEqual(sum(row["is_pinned"] for row in rows), 2)

    def test_metadata_is_stable_and_running_rows_become_interrupted(self):
        first = self.repo.metadata()
        self.repo.initialize()
        second = self.repo.metadata()
        self.assertEqual(first["workspace_id"], second["workspace_id"])
        self.assertEqual(first["origin_device_id"], second["origin_device_id"])

        run = make_run("r1")
        run = RunStart(**{**run.__dict__, "origin_device_id": first["origin_device_id"]})
        self.repo.create_run(run, [])
        self.assertEqual(self.repo.mark_interrupted(first["origin_device_id"]), 1)
        self.assertEqual(self.repo.get_run("r1")["status"], "interrupted")


if __name__ == "__main__":
    unittest.main()
