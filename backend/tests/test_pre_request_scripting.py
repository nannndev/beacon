import threading
import unittest

from backend.app.core.models import EndpointTest, TestConfig
from backend.app.core.scripting import PreRequestEngine, PreRequestError, PreRequestTimeout
from backend.app.core.tester import APITester


def _context():
    return {"url": "https://api.test/x", "method": "GET", "headers": {}, "body": {}, "variables": {"token": "abc"}}


class PreRequestScriptTests(unittest.TestCase):
    def run_script(self, script, timeout=5):
        return PreRequestEngine().execute(script, _context(), timeout=timeout)

    def test_mutates_request_and_variables(self):
        ctx = self.run_script(
            "import hashlib, json\n"
            "from urllib.parse import quote\n"
            "sig = hashlib.sha256(json.dumps({'a': 1}).encode()).hexdigest()\n"
            "beacon.request.headers['X-Sig'] = sig[:8]\n"
            "beacon.request.url = beacon.request.url + '?q=' + quote('a b')\n"
            "beacon.environment.set('nonce', beacon.environment.get('token') + '1')\n"
        )
        self.assertEqual(len(ctx["headers"]["X-Sig"]), 8)
        self.assertTrue(ctx["url"].endswith("?q=a%20b"))
        self.assertEqual(ctx["variables"]["nonce"], "abc1")

    def test_runs_on_worker_thread(self):
        # Runs dispatch requests from worker threads; SIGALRM-based timeouts
        # raised "signal only works in main thread" there.
        outcome = {}

        def target():
            try:
                outcome["ctx"] = self.run_script("beacon.request.headers['X-T'] = '1'")
            except Exception as exc:  # pragma: no cover - surfaced below
                outcome["error"] = exc

        thread = threading.Thread(target=target)
        thread.start()
        thread.join()
        self.assertNotIn("error", outcome)
        self.assertEqual(outcome["ctx"]["headers"]["X-T"], "1")

    def test_infinite_loop_times_out_even_when_caught(self):
        with self.assertRaises(PreRequestTimeout):
            self.run_script("while True:\n    try:\n        pass\n    except Exception:\n        pass\n", timeout=1)

    def test_known_escapes_are_rejected(self):
        escapes = [
            "import os",
            "__import__('os')",
            "().__class__.__base__.__subclasses__()",
            "uuid.os.system('true')",
            "json.codecs.sys.modules",
            "'{0.__class__}'.format(1)",
            "from urllib import request",
            "open('/etc/passwd')",
            "getattr(1, '__class__')",
        ]
        for script in escapes:
            with self.subTest(script=script), self.assertRaises(PreRequestError):
                self.run_script(script)


    def test_print_does_not_corrupt_the_worker_protocol(self):
        ctx = self.run_script("print('hello')\nbeacon.request.headers['X'] = 'ok'")
        self.assertEqual(ctx["headers"]["X"], "ok")

    def test_native_hang_is_killed_and_the_pool_recovers(self):
        # A catastrophic regex never returns to the bytecode loop, so only the
        # parent's hard deadline can stop it.
        with self.assertRaises(PreRequestTimeout):
            self.run_script("import re\nre.match('(a+)+$', 'a' * 64 + 'b')", timeout=1)
        ctx = self.run_script("beacon.request.headers['After'] = 'yes'")
        self.assertEqual(ctx["headers"]["After"], "yes")

    def test_runs_out_of_process(self):
        ctx = self.run_script("beacon.environment.set('pid', str(beacon.environment.get('token')))")
        # Mutations travel back through the returned context only.
        self.assertEqual(ctx["variables"]["pid"], "abc")


class TesterPreRequestTests(unittest.TestCase):
    def test_script_variable_writes_merge_into_config(self):
        endpoint = EndpointTest("e1", "E", "https://api.test/x", "GET",
                                pre_request_script="beacon.environment.set('nonce', 'n1')\n"
                                                   "beacon.request.headers['X-Nonce'] = 'n1'")
        config = TestConfig(variables={"keep": "1"}, tests=[endpoint])
        tester = APITester(endpoint, config, log_callback=lambda _m: None)

        url, headers, _ = tester._build_request()

        self.assertEqual(headers["X-Nonce"], "n1")
        self.assertEqual(config.variables, {"keep": "1", "nonce": "n1"})

    def test_failing_script_falls_back_to_the_templated_request(self):
        endpoint = EndpointTest("e1", "E", "https://api.test/x", "GET", pre_request_script="import os")
        logs = []
        tester = APITester(endpoint, TestConfig(tests=[endpoint]), log_callback=logs.append)

        url, headers, _ = tester._build_request()

        self.assertEqual(url, "https://api.test/x")
        self.assertTrue(any("not available" in line for line in logs))


if __name__ == "__main__":
    unittest.main()
