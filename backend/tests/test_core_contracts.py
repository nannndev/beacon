import unittest

from backend.app.core.tester import APITester, EndpointTest, TestConfig


class RecordingSession:
    def __init__(self):
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return object()


class CoreContractsTests(unittest.TestCase):
    def test_model_round_trip_keeps_endpoint_behavior(self):
        original = EndpointTest(
            "e1", "Upload", "/files", "post", {"X-Test": "yes"},
            {"file": "value"}, "multipart", {"token": "body.token"},
            {"concurrency": 2}, [{"type": "status", "op": "eq", "value": 201}], "web",
        )
        restored = EndpointTest.from_dict(original.to_dict())
        self.assertEqual(restored.to_dict(), original.to_dict())
        self.assertEqual(restored.method, "POST")

    def test_template_resolution_is_recursive_and_preserves_file_values(self):
        tester = APITester(EndpointTest("e1", "Demo", "/{{tenant}}"), TestConfig("", {"tenant": "acme"}))
        value = tester._substitute({
            "url": "/{{tenant}}/{{unknown}}",
            "nested": ["{{random_int:1:1}}"],
            "file": {"__file__": True, "data": "{{tenant}}"},
        })
        self.assertEqual(value["url"], "/acme/{{unknown}}")
        self.assertEqual(value["nested"], ["1"])
        self.assertEqual(value["file"]["data"], "{{tenant}}")

    def test_transport_keeps_raw_and_multipart_wire_contracts(self):
        raw = APITester(EndpointTest("raw", "Raw", "https://example.test", "POST", payload="hello", payload_type="raw"), TestConfig())
        session = RecordingSession()
        raw._do_request(session, "https://example.test", {"Content-Type": "text/plain"}, "hello")
        self.assertEqual(session.calls[0][2]["data"], b"hello")

        upload = APITester(EndpointTest("up", "Upload", "https://example.test", "POST", payload_type="multipart"), TestConfig())
        upload._do_request(session, "https://example.test", {"Content-Type": "multipart/form-data"}, {"note": "ok"})
        kwargs = session.calls[1][2]
        self.assertNotIn("Content-Type", kwargs["headers"])
        self.assertEqual(kwargs["files"]["note"], (None, "ok"))


if __name__ == "__main__":
    unittest.main()
