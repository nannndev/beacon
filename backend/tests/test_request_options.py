"""Per-endpoint request settings: timeout, redirects, TLS verification, proxy."""
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from backend.app.core.models import EndpointTest, TestConfig, normalize_request_options
from backend.app.core.tester import APITester


class _Handler(BaseHTTPRequestHandler):
    seen_paths: list = []

    def do_GET(self):
        type(self).seen_paths.append(self.path)
        if self.path.endswith("/slow"):
            time.sleep(1.5)
        if self.path.endswith("/redirect"):
            self.send_response(302)
            self.send_header("Location", "/final")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = b'{"ok": true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class LocalServerTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        _Handler.seen_paths.clear()

    def send(self, path, options=None, variables=None):
        endpoint = EndpointTest("e1", "E", self.base + path, "GET", request_options=options)
        tester = APITester(endpoint, TestConfig(variables=variables or {}), log_callback=lambda _m: None)
        tester._session().trust_env = False  # never route the test through an ambient proxy
        return tester.send_once()


class RequestOptionsTests(LocalServerTestCase):
    def test_timeout_overrides_the_default(self):
        result = self.send("/slow", {"timeout_s": 0.3})
        self.assertFalse(result["ok"])
        self.assertIn("timed out", result["error"].lower())

    def test_redirects_are_followed_unless_disabled(self):
        self.assertEqual(self.send("/redirect")["status"], 200)
        result = self.send("/redirect", {"follow_redirects": False})
        self.assertEqual(result["status"], 302)

    def test_proxy_receives_the_request_and_is_templated(self):
        # The local server doubles as an HTTP proxy: a proxied request arrives
        # with the absolute target URL as its path.
        target = "http://upstream.invalid/resource"
        endpoint = EndpointTest("e1", "E", target, "GET",
                                request_options={"proxy": "{{proxy_url}}"})
        tester = APITester(endpoint, TestConfig(variables={"proxy_url": self.base}),
                           log_callback=lambda _m: None)
        result = tester.send_once()
        self.assertEqual(result["status"], 200)
        self.assertIn(target, _Handler.seen_paths)

    def test_verify_ssl_false_reaches_the_transport(self):
        endpoint = EndpointTest("e1", "E", "https://self-signed.invalid/", "GET",
                                request_options={"verify_ssl": False})
        tester = APITester(endpoint, TestConfig(), log_callback=lambda _m: None)
        with patch("backend.app.core.transport.HttpTransport.send", side_effect=RuntimeError("stop")) as send:
            tester.send_once()
        self.assertIs(send.call_args.kwargs["verify"], False)


class RequestOptionsContractTests(unittest.TestCase):
    def test_only_non_default_values_are_kept(self):
        self.assertEqual(normalize_request_options(None), {})
        self.assertEqual(
            normalize_request_options({"timeout_s": "", "follow_redirects": True, "verify_ssl": True, "proxy": " "}),
            {},
        )
        self.assertEqual(
            normalize_request_options({"timeout_s": "45", "follow_redirects": False, "verify_ssl": False,
                                       "proxy": " http://proxy:8080 ", "junk": 1}),
            {"timeout_s": 45.0, "follow_redirects": False, "verify_ssl": False, "proxy": "http://proxy:8080"},
        )

    def test_endpoints_without_options_keep_their_persisted_shape(self):
        data = EndpointTest("e1", "E", "/x", "GET").to_dict()
        self.assertNotIn("request_options", data)
        restored = EndpointTest.from_dict({**data, "request_options": {"timeout_s": 60}})
        self.assertEqual(restored.to_dict()["request_options"], {"timeout_s": 60.0})

    def test_duplicate_keeps_every_field(self):
        from backend.app.routers import tests as tests_router

        original = EndpointTest("e1", "Signed", "/x", "POST", pre_request_script="x = 1",
                                ws_message="hi", request_options={"timeout_s": 90})
        store = type("S", (), {})()
        store.current_config = TestConfig(tests=[original])
        store.save = lambda: None
        with patch.object(tests_router, "store", store):
            copy = tests_router.duplicate_test("e1")

        self.assertNotEqual(copy["id"], "e1")
        self.assertEqual(copy["name"], "Signed (copy)")
        self.assertEqual(copy["pre_request_script"], "x = 1")
        self.assertEqual(copy["ws_message"], "hi")
        self.assertEqual(copy["request_options"], {"timeout_s": 90.0})


if __name__ == "__main__":
    unittest.main()
