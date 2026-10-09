"""Data-driven runs: CSV/JSON test data feeding load runs and scenarios."""
import threading
import unittest
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.app.core.datasets import DataFeeder, DatasetError, feeder_from_request, parse_dataset
from backend.app.core.models import EndpointTest, TestConfig
from backend.app.core.tester import APITester
from backend.app.routers import runs


class ParseDatasetTests(unittest.TestCase):
    def test_csv_with_bom_quotes_semicolons_and_blank_lines(self):
        text = '﻿username;password;note\n"alice";"s3cret";"a; b"\n\nbob;hunter2;\n'
        self.assertEqual(parse_dataset(text), [
            {"username": "alice", "password": "s3cret", "note": "a; b"},
            {"username": "bob", "password": "hunter2", "note": ""},
        ])

    def test_json_array_or_rows_object(self):
        rows = [{"id": 1, "active": True, "tags": ["a"], "none": None}]
        expected = [{"id": "1", "active": "true", "tags": '["a"]', "none": ""}]
        self.assertEqual(parse_dataset('[{"id": 1, "active": true, "tags": ["a"], "none": null}]'), expected)
        self.assertEqual(feeder_from_request({"dataset": {"rows": rows}}).rows, expected)
        self.assertEqual(parse_dataset('{"rows": [{"id": 2}]}'), [{"id": "2"}])

    def test_invalid_data_is_rejected_with_a_readable_message(self):
        for text, message in [
            ("", "no rows"),
            ("username\n", "no rows"),
            ("a,a\n1,2\n", "duplicate"),
            ("[1, 2]", "row 1 is not an object"),
            ('{"broken": ', "Invalid JSON"),
        ]:
            with self.subTest(text=text), self.assertRaisesRegex(DatasetError, message):
                parse_dataset(text)


class DataFeederTests(unittest.TestCase):
    def test_sequential_wraps_around_and_numbers_rows(self):
        feeder = DataFeeder([{"n": "1"}, {"n": "2"}])
        self.assertEqual([feeder.next() for _ in range(3)],
                         [(1, {"n": "1"}), (2, {"n": "2"}), (1, {"n": "1"})])

    def test_sequential_is_exact_under_concurrency(self):
        rows = [{"n": str(i)} for i in range(50)]
        feeder = DataFeeder(rows)
        seen = []
        lock = threading.Lock()

        def take():
            for _ in range(100):
                number, _row = feeder.next()
                with lock:
                    seen.append(number)

        threads = [threading.Thread(target=take) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        # 800 draws over 50 rows: every row exactly 16 times.
        self.assertEqual(set(Counter(seen).values()), {16})

    def test_random_mode_stays_in_range(self):
        feeder = DataFeeder([{"n": "1"}, {"n": "2"}, {"n": "3"}], mode="random", seed=4)
        self.assertTrue(all(1 <= feeder.next()[0] <= 3 for _ in range(30)))


class _Recorder(BaseHTTPRequestHandler):
    paths: list = []
    auth: list = []

    def do_GET(self):
        type(self).paths.append(self.path)
        type(self).auth.append(self.headers.get("Authorization"))
        body = b"{}"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class DataDrivenLoadRunTests(unittest.TestCase):
    def setUp(self):
        _Recorder.paths, _Recorder.auth = [], []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Recorder)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_each_request_takes_the_next_row_without_touching_the_environment(self):
        base = f"http://127.0.0.1:{self.server.server_port}"
        endpoint = EndpointTest("e1", "User", base + "/users/{{user_id}}", "GET",
                                headers={"Authorization": "Bearer {{token}}"})
        config = TestConfig(variables={"token": "env-token", "user_id": "0"})
        feeder = DataFeeder([{"user_id": "7"}, {"user_id": "8", "token": "row-token"}])
        responses = []
        tester = APITester(endpoint, config, concurrency=3, delay=0, max_requests=6,
                           log_callback=lambda _m: None, response_callback=responses.append,
                           data_feeder=feeder)
        tester.run()

        self.assertEqual(Counter(_Recorder.paths), {"/users/7": 3, "/users/8": 3})
        # A row value overrides the environment for that request only.
        self.assertEqual(Counter(_Recorder.auth), {"Bearer env-token": 3, "Bearer row-token": 3})
        self.assertEqual(config.variables, {"token": "env-token", "user_id": "0"})
        self.assertEqual(sorted(r["data_row"] for r in responses), [1, 1, 1, 2, 2, 2])


class FakeResponse:
    status_code = 200
    text = "{}"
    content = b"{}"
    headers = {"content-type": "application/json"}
    reason = "OK"
    history = []

    def __init__(self, url):
        self.url = url

    def json(self):
        return {}


class DataDrivenScenarioTests(unittest.TestCase):
    def make_store(self):
        login = EndpointTest("login", "Login", "/login?u={{username}}", "GET")
        profile = EndpointTest("profile", "Profile", "/profile?u={{username}}", "GET")
        history = SimpleNamespace(
            workspace_id="w", origin_device_id="d",
            start=lambda *a, **k: True, record_response=lambda *a, **k: None,
            record_stats=lambda *a, **k: None, finish_step=lambda *a, **k: None,
            finish_run=lambda *a, **k: None,
        )
        return SimpleNamespace(
            current_config=TestConfig(base_url="https://api.test", variables={"username": "env"},
                                      tests=[login, profile]),
            current_runs={}, projects=[{"id": "p1", "name": "P"}], current_project_id="p1",
            history=history, save=lambda: None,
        )

    def test_every_journey_uses_one_row_for_all_its_steps(self):
        store = self.make_store()
        urls = []

        def send(_self, _session, _endpoint, url, *_args, **_kwargs):
            urls.append(url)
            return FakeResponse(url)

        with patch("backend.app.routers.runs.store", store), \
             patch("backend.app.core.transport.HttpTransport.send", send):
            result = runs.run_scenario({
                "test_ids": ["login", "profile"],
                "dataset": {"text": "username\nalice\nbob\n"},
                "iterations": 2,
            })

        self.assertEqual(result["total_flows"], 2)
        self.assertEqual(urls, [
            "https://api.test/login?u=alice", "https://api.test/profile?u=alice",
            "https://api.test/login?u=bob", "https://api.test/profile?u=bob",
        ])
        # Rows never reach the shared environment.
        self.assertEqual(store.current_config.variables, {"username": "env"})

    def test_bad_test_data_is_a_400(self):
        with self.assertRaises(HTTPException) as error:
            runs.start_scenario({"test_ids": ["login"], "dataset": {"text": "a,a\n1,2"}})
        self.assertEqual(error.exception.status_code, 400)

    def test_preview_route(self):
        summary = runs.preview_dataset({"text": "user,pass\nalice,1\nbob,2\n"})
        self.assertEqual(summary["rows"], 2)
        self.assertEqual(summary["columns"], ["user", "pass"])
        self.assertEqual(summary["preview"][0], {"user": "alice", "pass": "1"})


if __name__ == "__main__":
    unittest.main()
