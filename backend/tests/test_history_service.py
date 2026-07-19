import json
import unittest

from backend.app.core.tester import EndpointTest
from backend.app.history.models import RunStart, RunStepStart
from backend.app.history.sanitize import sanitize_response_event, sanitize_run_config
from backend.app.history.service import HistoryService


class RecordingRepository:
    def __init__(self, fail=False):
        self.fail = fail
        self.created = []
        self.finished_steps = []
        self.finished_runs = []

    def initialize(self):
        if self.fail:
            raise RuntimeError("database details must not escape")

    def metadata(self):
        return {"workspace_id": "w1", "origin_device_id": "d1"}

    def create_run(self, run, steps):
        if self.fail:
            raise RuntimeError("write failed with SECRET")
        self.created.append((run, steps))

    def finalize_step(self, run_id, sequence, status, metrics):
        self.finished_steps.append((run_id, sequence, status, metrics))

    def finalize_run(self, run_id, status, metrics, samples, events):
        self.finished_runs.append((run_id, status, metrics, samples, events))

    def enforce_retention(self, project_id):
        return 0


def endpoint_fixture(**overrides):
    data = {
        "test_id": "e1",
        "name": "List posts",
        "url": "/posts/{{post_id}}",
        "method": "GET",
        "headers": {},
        "payload": {},
    }
    data.update(overrides)
    return EndpointTest(**data)


def run_start() -> RunStart:
    return RunStart(
        id="r1",
        workspace_id="w1",
        project_id="p1",
        project_name="Demo",
        origin_device_id="d1",
        source_type="endpoint",
        target_id="e1",
        target_name="List posts",
        mode="load",
        config_snapshot={"mode": "load"},
    )


class HistoryServiceTests(unittest.TestCase):
    def test_sanitizer_drops_every_secret_surface(self):
        endpoint = endpoint_fixture(
            headers={"Authorization": "Bearer SECRET"},
            payload={"password": "SECRET"},
        )
        clean = sanitize_run_config(
            {
                "mode": "load",
                "concurrency": 2,
                "headers": endpoint.headers,
                "payload": endpoint.payload,
                "unknown": "SECRET",
            },
            endpoint,
        )

        self.assertNotIn("SECRET", json.dumps(clean))
        self.assertEqual(
            clean,
            {
                "mode": "load",
                "concurrency": 2,
                "method": "GET",
                "url_template": "/posts/{{post_id}}",
            },
        )
        event = sanitize_response_event(
            {"error": "Bearer SECRET timed out", "time_ms": 20}, 100
        )
        self.assertNotIn("SECRET", json.dumps(event.__dict__))
        self.assertEqual(event.error_category, "timeout")

    def test_service_bounds_buffers_and_calculates_metrics(self):
        repo = RecordingRepository()
        service = HistoryService(repo)
        service.initialize()
        service.start(
            run_start(),
            [RunStepStart(0, "e1", "List posts", "GET", "/posts")],
        )
        for index in range(350):
            service.record_stats(
                "r1",
                0,
                {"attempts": index + 1, "success": index + 1, "rate_limited": 0, "errors": 0},
                elapsed_ms=(index + 1) * 100,
            )
        for index in range(250):
            service.record_response(
                "r1",
                0,
                {"success": True, "status": 200, "time_ms": index + 1},
                elapsed_ms=index * 10,
            )
        service.finish_step("r1", 0, "completed")
        service.finish_run("r1", "completed")

        _, status, metrics, samples, events = repo.finished_runs[0]
        self.assertEqual(status, "completed")
        self.assertEqual(metrics.attempts, 350)
        self.assertIsNotNone(metrics.p95_ms)
        self.assertLessEqual(len(samples), 300)
        self.assertLessEqual(len(events), 200)

    def test_repository_failures_disable_history_without_raising(self):
        service = HistoryService(RecordingRepository(fail=True))

        service.initialize()
        service.start(run_start(), [])
        service.record_stats("r1", 0, {"attempts": 1}, elapsed_ms=10)
        service.finish_run("r1", "completed")

        self.assertFalse(service.available)
        self.assertEqual(service.error_code, "history_unavailable")


if __name__ == "__main__":
    unittest.main()
