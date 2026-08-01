"""Concurrency contract for extractor writes into shared config variables.

Extractors refresh tokens by writing into `config.variables` from worker
threads while templating reads the same mapping to build requests. Before the
config-level guard, a write that added a key mid-resolve raised
"dictionary changed size during iteration"; because `_build_request()` runs
outside `_send_one`'s try block and `run()` never calls `future.result()`,
those requests disappeared with no error recorded — a run could report 100%
success while several percent of the traffic was never sent.
"""
import itertools
import threading
import unittest

from backend.app.core.models import EndpointTest, TestConfig
from backend.app.core.templating import TemplateResolver
from backend.app.core.tester import APITester


class FakeResponse:
    status_code = 200
    headers = {"content-type": "application/json"}
    content = b"{}"
    url = "https://target.test/login"
    history = []
    reason = "OK"
    text = '{"access_token":"fresh-token"}'

    def json(self):
        return {"access_token": "fresh-token"}


def _chained_login_tester(variable_count: int, concurrency: int, requests_total: int):
    """An APITester whose extractor adds a new variable on every response, the
    way a chained login/session flow does."""
    variables = {f"var_{index}": f"value_{index}" for index in range(variable_count)}
    variables["access_token"] = "seed"
    config = TestConfig(base_url="https://target.test", variables=variables)
    endpoint = EndpointTest(
        "login", "Login", "/login", "POST",
        headers={"Authorization": "Bearer {{access_token}}", "X-Trace": "{{var_1}}"},
        payload={"a": "{{var_2}}", "b": "{{var_3}}", "c": "{{var_4}}"},
        extractors={"access_token": "body.access_token"},
    )

    tester = APITester(endpoint, config, concurrency=concurrency, delay=0,
                       max_requests=requests_total)
    counter = itertools.count()
    original_apply = tester.extractor.apply

    def apply(test, response, variables_ref, log):
        variables_ref[f"session_{next(counter)}"] = "x"
        return original_apply(test, response, variables_ref, log)

    tester.extractor.apply = apply
    tester._do_request = lambda *args, **kwargs: FakeResponse()
    tester.log = lambda *args, **kwargs: None
    return tester


class ExtractorConcurrencyTests(unittest.TestCase):
    def test_concurrent_run_never_silently_drops_requests(self):
        total = 600
        tester = _chained_login_tester(variable_count=400, concurrency=16,
                                       requests_total=total)

        results = tester.run()

        # Every request must be accounted for. A shortfall here means requests
        # died in _build_request() and were never counted as attempts at all.
        self.assertEqual(results["attempts"], total)
        self.assertEqual(results["success"], total)
        self.assertEqual(results["errors"], 0)

    def test_resolver_tolerates_variables_growing_during_resolution(self):
        variables = {"base": "x"}
        resolver = TemplateResolver(variables, threading.RLock())
        failures = []
        stop = threading.Event()

        def reader():
            while not stop.is_set():
                try:
                    resolver.resolve("Bearer {{base}}")
                except Exception as error:  # pragma: no cover - failure path
                    failures.append(repr(error))
                    return

        def writer():
            index = 0
            while not stop.is_set():
                variables[f"token_{index}"] = "v"
                index += 1

        threads = [threading.Thread(target=reader) for _ in range(4)]
        threads.append(threading.Thread(target=writer))
        for thread in threads:
            thread.start()
        stop.wait(1.0)
        stop.set()
        for thread in threads:
            thread.join()

        self.assertEqual(failures, [])

    def test_payload_fields_see_one_consistent_variable_view(self):
        """All fields of a single request resolve against the same snapshot,
        so a token refreshed mid-request cannot half-apply to one payload."""
        variables = {"token": "first"}
        resolver = TemplateResolver(variables, threading.RLock())
        resolved = resolver.resolve({"a": "{{token}}", "nested": ["{{token}}"]})
        self.assertEqual(resolved["a"], "first")
        self.assertEqual(resolved["nested"], ["first"])

    def test_config_snapshot_is_a_copy(self):
        config = TestConfig("", {"a": "1"})
        snapshot = config.snapshot_variables()
        snapshot["a"] = "mutated"
        self.assertEqual(config.variables["a"], "1")


if __name__ == "__main__":
    unittest.main()
