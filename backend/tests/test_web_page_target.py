import unittest
from datetime import timedelta

from backend.app.core.tester import APITester, EndpointTest, TestConfig


class FakeResponse:
    status_code = 200
    reason = "OK"
    headers = {"content-type": "text/html; charset=utf-8"}
    text = "<html><body>Beacon</body></html>"
    content = text.encode("utf-8")
    url = "https://example.com/home"
    history = [object()]
    elapsed = timedelta(milliseconds=42)


class RecordingSession:
    def __init__(self):
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return FakeResponse()


class WebPageTargetTests(unittest.TestCase):
    def test_target_type_round_trips_and_legacy_defaults_to_api(self):
        web = EndpointTest(
            "web-1",
            "Homepage",
            "https://example.com/",
            "GET",
            target_type="web",
        )

        self.assertEqual(web.to_dict()["target_type"], "web")
        self.assertEqual(EndpointTest.from_dict(web.to_dict()).target_type, "web")
        self.assertEqual(
            EndpointTest.from_dict({"id": "old", "name": "Legacy", "url": "/api"}).target_type,
            "api",
        )

    def test_web_page_request_has_no_json_body_and_reports_navigation_metadata(self):
        endpoint = EndpointTest(
            "web-1",
            "Homepage",
            "https://example.com/",
            "GET",
            headers={"Accept": "text/html"},
            payload={"should": "not be sent"},
            target_type="web",
        )
        tester = APITester(endpoint, TestConfig())
        session = RecordingSession()
        tester._session = lambda: session

        result = tester.send_once()

        self.assertEqual(len(session.calls), 1)
        method, url, kwargs = session.calls[0]
        self.assertEqual(method, "GET")
        self.assertEqual(url, "https://example.com/")
        self.assertNotIn("json", kwargs)
        self.assertNotIn("data", kwargs)
        self.assertEqual(result["target_type"], "web")
        self.assertEqual(result["final_url"], "https://example.com/home")
        self.assertEqual(result["redirects"], 1)
        self.assertEqual(result["ttfb_ms"], 42)
        self.assertEqual(result["content_type"], "text/html; charset=utf-8")


if __name__ == "__main__":
    unittest.main()


class ResolveTargetTests(unittest.TestCase):
    def test_absolute_urls_of_any_scheme_are_kept(self):
        from backend.app.core.transport import resolve_target

        base = "http://localhost:4010"
        self.assertEqual(resolve_target(base, "ws://localhost:4000/ws/echo"), "ws://localhost:4000/ws/echo")
        self.assertEqual(resolve_target(base, "WSS://feed.example.com/live"), "WSS://feed.example.com/live")
        self.assertEqual(resolve_target(base, "https://api.example.com/x"), "https://api.example.com/x")
        self.assertEqual(resolve_target(base + "/", "/posts/1"), "http://localhost:4010/posts/1")
        self.assertEqual(resolve_target(base, "posts"), "http://localhost:4010/posts")
