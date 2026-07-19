import json
import os
import sqlite3
import tempfile
import unittest

from backend.app.core.tester import EndpointTest
from backend.app.history.models import RunStart, RunStepStart
from backend.app.history.sanitize import sanitize_run_config
from backend.app.history.service import HistoryService
from backend.app.history.sqlite_repository import SqliteRunHistoryRepository


class HistoryPrivacyRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "history.db")
        self.repository = SqliteRunHistoryRepository(self.path)
        self.service = HistoryService(self.repository)
        self.service.initialize()

    def tearDown(self):
        self.tmp.cleanup()

    def test_secret_canary_never_reaches_any_sqlite_text_column(self):
        canary = "BEACON_SECRET_CANARY_9f44"
        endpoint = EndpointTest(
            "e1",
            "Secret endpoint",
            "/users/{{secret_id}}",
            "POST",
            headers={"Authorization": f"Bearer {canary}"},
            payload={"password": canary},
        )
        config = sanitize_run_config(
            {"mode": "load", "concurrency": 1, "headers": endpoint.headers, "payload": endpoint.payload},
            endpoint,
        )
        self.service.start(
            RunStart(
                id="r1",
                workspace_id=self.service.workspace_id,
                project_id="p1",
                project_name="Privacy test",
                origin_device_id=self.service.origin_device_id,
                source_type="endpoint",
                target_id=endpoint.id,
                target_name=endpoint.name,
                mode="load",
                config_snapshot=config,
            ),
            [RunStepStart(0, endpoint.id, endpoint.name, endpoint.method, endpoint.url)],
        )
        self.service.record_response(
            "r1",
            0,
            {
                "error": f"Authorization failed for Bearer {canary}",
                "body": canary,
                "headers": {"Set-Cookie": canary},
                "time_ms": 10,
            },
        )
        self.service.record_stats("r1", 0, {"attempts": 1, "success": 0, "rate_limited": 0, "errors": 1})
        self.service.finish_step("r1", 0, "failed")

        connection = sqlite3.connect(self.path)
        try:
            tables = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )]
            text_values = []
            for table in tables:
                columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})") if "TEXT" in str(row[2]).upper()]
                for column in columns:
                    text_values.extend(row[0] for row in connection.execute(f'SELECT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL'))
        finally:
            connection.close()
        self.assertNotIn(canary, json.dumps(text_values))

    def test_confirmed_rebuild_preserves_backup_and_resets_history(self):
        self.repository.create_run(
            RunStart(
                id="r1", workspace_id=self.service.workspace_id, project_id="p1",
                project_name="Demo", origin_device_id=self.service.origin_device_id,
                source_type="endpoint", target_id="e1", target_name="Run",
                mode="load", config_snapshot={"mode": "load"},
            ),
            [],
        )

        self.service.rebuild()

        self.assertTrue(self.service.available)
        self.assertTrue(self.repository.backup_exists())
        self.assertEqual(self.repository.list_runs({}, None, 30)["items"], [])


if __name__ == "__main__":
    unittest.main()
