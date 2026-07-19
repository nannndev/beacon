import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.core.tester import EndpointTest, TestConfig
from backend.app.routers import runs
from backend.app import mcp_server
from backend.app.history.service import HistoryService


class RecordingHistory:
    available = True
    workspace_id = "w1"
    origin_device_id = "d1"

    def __init__(self):
        self.started = []
        self.stats = []
        self.responses = []
        self.finished_steps = []
        self.finished = []

    def start(self, run, steps):
        self.started.append((run, steps))
        return True

    def record_stats(self, history_id, step_index, stats, elapsed_ms=None):
        self.stats.append((history_id, step_index, stats))

    def record_response(self, history_id, step_index, response, elapsed_ms=None):
        self.responses.append((history_id, step_index, response))

    def finish_step(self, history_id, step_index, status):
        self.finished_steps.append((history_id, step_index, status))

    def finish_run(self, history_id, status):
        self.finished.append((history_id, status))


class FailingHistoryRepository:
    def initialize(self):
        raise RuntimeError("history unavailable")


class ImmediateThread:
    def __init__(self, target, daemon=True):
        self.target = target

    def start(self):
        self.target()


class FakeTester:
    def __init__(self, *args, **kwargs):
        self.stats_callback = kwargs.get("stats_callback")
        self.response_callback = kwargs.get("response_callback")

    def run_mode(self, mode, params):
        self.response_callback({"success": True, "status": 200, "time_ms": 25})
        self.stats_callback({"attempts": 2, "success": 2, "rate_limited": 0, "errors": 0})
        return {"attempts": 2, "success": 2, "rate_limited": 0, "errors": 0}

    def run(self):
        result = {"attempts": 2, "success": 2, "rate_limited": 0, "errors": 0}
        if self.response_callback:
            self.response_callback({"success": True, "status": 200, "time_ms": 25})
        self.stats_callback(result)
        return result

    def send_once(self, **kwargs):
        return {"ok": True, "status": 200, "time_ms": 10}


def target_store(history):
    endpoint = EndpointTest("e1", "List posts", "/posts", "GET")
    second = EndpointTest("e2", "Create post", "/posts", "POST")
    project = {"id": "p1", "name": "Demo"}
    return SimpleNamespace(
        current_config=TestConfig("https://example.test", {}, [endpoint, second]),
        current_project_id="p1",
        projects=[project],
        current_runs={},
        history=history,
        save=lambda: None,
        load=lambda: None,
    )


class HistoryRunnerIntegrationTests(unittest.TestCase):
    def test_single_run_finalizes_one_history_step(self):
        history = RecordingHistory()
        fake_store = target_store(history)
        with (
            patch.object(runs, "store", fake_store),
            patch.object(runs, "APITester", FakeTester),
            patch.object(runs.threading, "Thread", ImmediateThread),
            patch.object(runs.runner, "dispatch", lambda coroutine: coroutine.close()),
        ):
            response = asyncio.run(
                runs.start_run(
                    {"test_id": "e1", "mode": "load", "max_requests": 2}
                )
            )

        self.assertEqual(response["history_id"], response["run_id"])
        self.assertEqual(history.finished[0][1], "completed")
        self.assertEqual(history.finished_steps[0][2], "completed")
        self.assertEqual(history.started[0][1][0].url_template, "/posts")

    def test_single_send_never_records_history(self):
        history = RecordingHistory()
        fake_store = target_store(history)
        with (
            patch.object(runs, "store", fake_store),
            patch.object(runs, "APITester", FakeTester),
        ):
            result = runs.send_single({"test_id": "e1"})

        self.assertEqual(result["status"], 200)
        self.assertEqual(history.started, [])

    def test_scenario_is_one_history_parent_with_ordered_steps(self):
        history = RecordingHistory()
        fake_store = target_store(history)
        with (
            patch.object(runs, "store", fake_store),
            patch.object(runs, "APITester", FakeTester),
        ):
            result = runs.run_scenario({"test_ids": ["e1", "e2"]})

        self.assertIn("history_id", result)
        self.assertEqual(len(history.started), 1)
        self.assertEqual(
            [step.sequence for step in history.started[0][1]], [0, 1]
        )
        self.assertEqual(len(history.finished_steps), 2)
        self.assertEqual(history.finished[0][1], "completed")

    def test_mcp_run_is_recorded_but_mcp_send_is_not(self):
        history = RecordingHistory()
        fake_store = target_store(history)
        endpoint = fake_store.current_config.tests[0]
        with (
            patch.object(mcp_server, "store", fake_store),
            patch.object(mcp_server, "_reload", lambda: None),
            patch.object(mcp_server, "_find_test", lambda value: endpoint),
            patch.object(mcp_server, "APITester", FakeTester),
        ):
            run_result = mcp_server.run_endpoint("List posts", count=2)
            send_result = mcp_server.send_request("List posts")

        self.assertIn("history_id", run_result)
        self.assertNotIn("history_id", send_result)
        self.assertEqual(len(history.started), 1)

    def test_unavailable_history_never_blocks_a_live_run(self):
        history = HistoryService(FailingHistoryRepository())
        history.initialize()
        fake_store = target_store(history)
        with (
            patch.object(runs, "store", fake_store),
            patch.object(runs, "APITester", FakeTester),
            patch.object(runs.threading, "Thread", ImmediateThread),
            patch.object(runs.runner, "dispatch", lambda coroutine: coroutine.close()),
        ):
            response = asyncio.run(runs.start_run({"test_id": "e1", "max_requests": 2}))

        self.assertIsNone(response["history_id"])
        self.assertEqual(fake_store.current_runs[response["run_id"]]["status"], "finished")


if __name__ == "__main__":
    unittest.main()
