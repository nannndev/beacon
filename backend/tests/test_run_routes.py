"""Route-level contract for the run lifecycle: /run, /send, /scenario,
/scenario/start, /stop/{run_id}, /status/{run_id}.

These are the hottest paths in the product and previously had no route
coverage. Every test stubs the HTTP transport, so the request-scheduling and
lifecycle logic is exercised without touching the network.
"""
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.app.core.models import EndpointTest, TestConfig
from backend.app.routers import runs


class FakeResponse:
    """Minimal stand-in for requests.Response."""

    def __init__(self, status_code=200, body='{"access_token":"fresh"}',
                 headers=None, reason="OK"):
        self.status_code = status_code
        self.text = body
        self.content = body.encode()
        self.headers = headers or {"content-type": "application/json"}
        self.reason = reason
        self.url = "https://example.test/target"
        self.history = []

    def json(self):
        import json
        return json.loads(self.text)


class FakeHistory:
    """Records the history calls a run is expected to make."""

    workspace_id = "ws"
    origin_device_id = "device"

    def __init__(self):
        self.started = []
        self.finished = []
        self.steps_finished = []
        self.stats = []
        self.responses = []

    def start(self, run_start, steps=None):
        self.started.append((run_start, steps))

    def record_response(self, *args):
        self.responses.append(args)

    def record_stats(self, history_id, step_index, stats):
        self.stats.append((history_id, step_index, stats))

    def finish_step(self, history_id, step_index, status):
        self.steps_finished.append((history_id, step_index, status))

    def finish_run(self, history_id, status):
        self.finished.append((history_id, status))


def make_store(tests=None):
    config = TestConfig(base_url="https://example.test",
                        variables={"access_token": "seed"},
                        tests=tests or [])
    store = SimpleNamespace(
        current_config=config,
        current_runs={},
        projects=[{"id": "p1", "name": "Project One"}],
        current_project_id="p1",
        history=FakeHistory(),
        active_websockets=[],
        save_calls=0,
    )
    store.save = lambda: setattr(store, "save_calls", store.save_calls + 1)
    return store


def login_endpoint():
    return EndpointTest("login", "Login", "/login", "POST",
                        headers={"Authorization": "Bearer {{access_token}}"},
                        extractors={"access_token": "body.access_token"})


def plain_endpoint(test_id="e1", name="Plain", assertions=None):
    return EndpointTest(test_id, name, "/thing", "GET", assertions=assertions or [])


class SendRouteTests(unittest.TestCase):
    def test_send_returns_full_response_and_persists_extracted_token(self):
        store = make_store([login_endpoint()])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse()):
            result = runs.send_single({"test_id": "login"})

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["extracted"], ["access_token"])
        # The refreshed token must be written back for the next call...
        self.assertEqual(store.current_config.variables["access_token"], "fresh")
        # ...and persisted, so it survives a reload.
        self.assertEqual(store.save_calls, 1)

    def test_send_does_not_persist_when_nothing_was_extracted(self):
        store = make_store([plain_endpoint()])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse(body="{}")):
            result = runs.send_single({"test_id": "e1"})

        self.assertEqual(result["extracted"], [])
        self.assertEqual(store.save_calls, 0)

    def test_send_evaluates_assertions(self):
        endpoint = plain_endpoint(assertions=[{"type": "status", "op": "eq", "value": 500}])
        store = make_store([endpoint])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse(body="{}")):
            result = runs.send_single({"test_id": "e1"})

        self.assertIs(result["passed"], False)

    def test_send_retries_until_success_and_reports_attempts(self):
        store = make_store([plain_endpoint()])
        responses = [FakeResponse(status_code=503, body="{}"),
                     FakeResponse(status_code=503, body="{}"),
                     FakeResponse(status_code=200, body="{}")]
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   side_effect=responses):
            result = runs.send_single({"test_id": "e1", "retries": 2, "retry_delay": 0})

        self.assertEqual(result["status"], 200)
        self.assertEqual(result["attempts"], 3)

    def test_send_surfaces_transport_failure_without_raising(self):
        store = make_store([plain_endpoint()])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   side_effect=RuntimeError("connection refused")):
            result = runs.send_single({"test_id": "e1"})

        self.assertFalse(result["ok"])
        self.assertIn("connection refused", result["error"])

    def test_send_rejects_missing_and_unknown_endpoints(self):
        store = make_store([plain_endpoint()])
        with patch("backend.app.routers.runs.store", store):
            with self.assertRaises(HTTPException) as missing:
                runs.send_single({})
            self.assertEqual(missing.exception.status_code, 400)

            with self.assertRaises(HTTPException) as unknown:
                runs.send_single({"test_id": "nope"})
            self.assertEqual(unknown.exception.status_code, 404)

    def test_send_rejects_non_numeric_retry_settings(self):
        store = make_store([plain_endpoint()])
        with patch("backend.app.routers.runs.store", store):
            with self.assertRaises(HTTPException) as error:
                runs.send_single({"test_id": "e1", "retries": "many"})
        self.assertEqual(error.exception.status_code, 400)


class RunRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_rejects_missing_and_unknown_endpoints(self):
        store = make_store([plain_endpoint()])
        with patch("backend.app.routers.runs.store", store):
            with self.assertRaises(HTTPException) as missing:
                await runs.start_run({})
            self.assertEqual(missing.exception.status_code, 400)

            with self.assertRaises(HTTPException) as unknown:
                await runs.start_run({"test_id": "ghost"})
            self.assertEqual(unknown.exception.status_code, 404)

    async def test_run_rejects_non_numeric_execution_settings(self):
        store = make_store([plain_endpoint()])
        with patch("backend.app.routers.runs.store", store):
            for payload in ({"test_id": "e1", "concurrency": "lots"},
                            {"test_id": "e1", "max_requests": "all"},
                            {"test_id": "e1", "history_step_index": "first"}):
                with self.subTest(payload=payload):
                    with self.assertRaises(HTTPException) as error:
                        await runs.start_run(payload)
                    self.assertEqual(error.exception.status_code, 400)

    async def test_run_forwards_mode_and_params_to_the_coordinator(self):
        store = make_store([plain_endpoint()])
        captured = {}

        class FakeCoordinator:
            def __init__(self, *args, **kwargs):
                pass

            def start(self, test, *, mode, params, request_config,
                      history_id=None, history_step_index=0):
                captured.update(test=test, mode=mode, params=params,
                                history_step_index=history_step_index)
                return {"run_id": "abc", "mode": mode}

        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.routers.runs.EndpointRunCoordinator", FakeCoordinator):
            result = await runs.start_run({
                "test_id": "e1", "mode": "RAMP  ", "ramp_end": 32,
                "concurrency": 4, "max_requests": 25,
            })

        self.assertEqual(result, {"run_id": "abc", "mode": "ramp"})
        self.assertEqual(captured["params"]["ramp_end"], 32)
        self.assertEqual(captured["params"]["concurrency"], 4)
        self.assertEqual(captured["params"]["max_requests"], 25)

    async def test_use_min_delay_overrides_the_requested_delay(self):
        store = make_store([plain_endpoint()])
        captured = {}

        class FakeCoordinator:
            def __init__(self, *args, **kwargs):
                pass

            def start(self, test, *, mode, params, **kwargs):
                captured.update(params=params)
                return {"run_id": "abc"}

        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.routers.runs.EndpointRunCoordinator", FakeCoordinator):
            await runs.start_run({"test_id": "e1", "delay": 5.0, "use_min_delay": True})

        self.assertEqual(captured["params"]["delay"], 0.001)


class ScenarioRouteTests(unittest.TestCase):
    def test_scenario_runs_steps_in_order_and_chains_extracted_tokens(self):
        store = make_store([login_endpoint(), plain_endpoint("e2", "Profile")])
        sent = []

        def fake_send(self, session, endpoint, url, headers, payload, timeout=10):
            sent.append((endpoint.id, headers.get("Authorization")))
            return FakeResponse()

        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send", fake_send):
            result = runs.run_scenario({"test_ids": ["login", "e2"]})

        self.assertTrue(result["passed"])
        self.assertEqual(result["completed"], 2)
        self.assertEqual([step["test_id"] for step in result["steps"]], ["login", "e2"])
        # Step one sent the seeded token; the token it extracted is now live.
        self.assertEqual(sent[0], ("login", "Bearer seed"))
        self.assertEqual(store.current_config.variables["access_token"], "fresh")
        self.assertEqual(store.history.finished[-1][1], "completed")

    def test_scenario_stops_at_the_first_failure_by_default(self):
        store = make_store([plain_endpoint("a", "A"), plain_endpoint("b", "B")])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse(status_code=500, body="{}")):
            result = runs.run_scenario({"test_ids": ["a", "b"]})

        self.assertFalse(result["passed"])
        self.assertEqual(len(result["steps"]), 1)
        self.assertEqual(result["steps"][0]["failure"]["kind"], "http_error")
        self.assertEqual(store.history.finished[-1][1], "failed")

    def test_continue_on_error_runs_every_step(self):
        store = make_store([plain_endpoint("a", "A"), plain_endpoint("b", "B")])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse(status_code=500, body="{}")):
            result = runs.run_scenario({"test_ids": ["a", "b"], "continue_on_error": True})

        self.assertFalse(result["passed"])
        self.assertEqual(len(result["steps"]), 2)

    def test_unknown_step_is_reported_without_aborting_the_contract(self):
        store = make_store([plain_endpoint("a", "A")])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse(body="{}")):
            result = runs.run_scenario({"test_ids": ["ghost", "a"],
                                        "continue_on_error": True})

        self.assertEqual(result["steps"][0]["failure"]["kind"], "endpoint_missing")
        self.assertEqual(len(result["steps"]), 2)

    def test_assertion_failure_is_surfaced_without_the_response_body(self):
        endpoint = plain_endpoint("a", "A", assertions=[
            {"type": "status", "op": "eq", "value": 201},
        ])
        store = make_store([endpoint])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse(body='{"secret":"do-not-leak"}')):
            result = runs.run_scenario({"test_ids": ["a"]})

        failure = result["steps"][0]["failure"]
        self.assertEqual(failure["kind"], "assertion_failed")
        self.assertNotIn("do-not-leak", str(result["steps"]))

    def test_transport_timeout_is_classified_as_a_timeout_failure(self):
        store = make_store([plain_endpoint("a", "A")])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   side_effect=RuntimeError("Read timed out")):
            result = runs.run_scenario({"test_ids": ["a"]})

        self.assertEqual(result["steps"][0]["failure"]["kind"], "timeout")

    def test_scenario_rejects_an_empty_or_non_list_step_set(self):
        store = make_store([])
        with patch("backend.app.routers.runs.store", store):
            for payload in ({"test_ids": []}, {"test_ids": "login"}, {}):
                with self.subTest(payload=payload):
                    with self.assertRaises(HTTPException) as error:
                        runs.run_scenario(payload)
                    self.assertEqual(error.exception.status_code, 400)

    def test_scenario_rejects_non_numeric_settings(self):
        store = make_store([plain_endpoint("a", "A")])
        with patch("backend.app.routers.runs.store", store):
            with self.assertRaises(HTTPException) as error:
                runs.run_scenario({"test_ids": ["a"], "virtual_users": "many"})
        self.assertEqual(error.exception.status_code, 400)

    def test_virtual_users_run_every_journey_with_isolated_variables(self):
        store = make_store([login_endpoint()])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse()):
            result = runs.run_scenario({
                "test_ids": ["login"], "virtual_users": 3, "iterations": 2,
            })

        self.assertEqual(result["total_flows"], 6)
        self.assertEqual(result["completed_flows"], 6)
        self.assertEqual(result["successful_flows"], 6)
        self.assertTrue(result["passed"])

    def test_stop_flag_halts_the_scenario_and_marks_it_stopped(self):
        store = make_store([plain_endpoint("a", "A"), plain_endpoint("b", "B")])
        stop_flag = {"stop": True}
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse(body="{}")):
            result = runs.run_scenario({"test_ids": ["a", "b"], "_stop_flag": stop_flag})

        self.assertTrue(result["stopped"])
        self.assertFalse(result["passed"])
        self.assertEqual(store.history.finished[-1][1], "stopped")


class RunControlRouteTests(unittest.TestCase):
    def _wait_for(self, predicate, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if predicate():
                return True
            time.sleep(0.01)
        return False

    def test_scenario_start_returns_a_run_id_and_reaches_a_terminal_status(self):
        store = make_store([plain_endpoint("a", "A")])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send",
                   return_value=FakeResponse(body="{}")):
            started = runs.start_scenario({"test_ids": ["a"]})
            run_id = started["run_id"]
            self.assertEqual(started["mode"], "scenario")
            self.assertTrue(self._wait_for(
                lambda: store.current_runs[run_id]["status"] == "finished"))
            status = runs.get_status(run_id)

        self.assertEqual(status["status"], "finished")
        self.assertTrue(status["result"]["passed"])

    def test_a_failing_scenario_thread_records_the_failure_instead_of_hanging(self):
        store = make_store([plain_endpoint("a", "A")])
        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.routers.runs.run_scenario",
                   side_effect=RuntimeError("boom")):
            run_id = runs.start_scenario({"test_ids": ["a"]})["run_id"]
            self.assertTrue(self._wait_for(
                lambda: store.current_runs[run_id]["status"] == "failed"))
            status = runs.get_status(run_id)

        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["failure"]["message"], "boom")

    def test_stop_marks_a_live_run_as_stopping_and_sets_its_flag(self):
        store = make_store([])
        stop_flag = {"stop": False}
        store.current_runs["r1"] = {
            "status": "running", "stop_flag": stop_flag, "logs": [],
            "responses": [], "stats": {}, "lock": threading.Lock(),
        }
        with patch("backend.app.routers.runs.store", store):
            result = runs.stop_run("r1")

        self.assertEqual(result["status"], "stopping")
        self.assertTrue(stop_flag["stop"])
        self.assertEqual(store.current_runs["r1"]["status"], "stopping")

    def test_stopping_an_unknown_run_is_a_no_op_rather_than_an_error(self):
        store = make_store([])
        with patch("backend.app.routers.runs.store", store):
            self.assertEqual(runs.stop_run("gone"), {"status": "stopping"})

    def test_status_for_an_unknown_run_is_404(self):
        store = make_store([])
        with patch("backend.app.routers.runs.store", store):
            with self.assertRaises(HTTPException) as error:
                runs.get_status("gone")
        self.assertEqual(error.exception.status_code, 404)

    def test_status_truncates_logs_and_hides_internal_step_state(self):
        store = make_store([])
        store.current_runs["r1"] = {
            "status": "running",
            "stats": {"attempts": 3},
            "logs": [f"line-{i}" for i in range(150)],
            "responses": [{"attempt": i} for i in range(150)],
            "result": None,
            "progress": {"completed_flows": 1},
            "scenario_steps": [{"name": "A", "_latencies": [1, 2, 3]}],
            "recent_events": [],
            "failure": None,
            "lock": threading.Lock(),
        }
        with patch("backend.app.routers.runs.store", store):
            status = runs.get_status("r1")

        self.assertEqual(len(status["logs"]), 100)
        self.assertEqual(len(status["responses"]), 100)
        # `_latencies` is internal bookkeeping and must not leak to clients.
        self.assertNotIn("_latencies", status["scenario_steps"][0])
        # The response must be a copy: mutating it cannot corrupt live state.
        status["scenario_steps"][0]["name"] = "mutated"
        self.assertEqual(store.current_runs["r1"]["scenario_steps"][0]["name"], "A")


if __name__ == "__main__":
    unittest.main()
