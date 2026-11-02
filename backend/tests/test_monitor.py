import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.services.monitor import MonitorScheduler

class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/ok" else 500)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):
        pass

def _project(base, minutes):
    return {
        "id": "p1",
        "name": "Shop",
        "environments": [{"id": "e1", "name": "Dev", "base_url": base, "variables": {}}],
        "current_environment_id": "e1",
        "notifications": {"mode": "on_failure", "discord_webhook": "", "monitor_minutes": minutes},
        "items": [{"type": "folder", "name": "f", "items": [
            {"type": "request", "id": "a", "name": "ok", "method": "GET", "url": "/ok"},
            {"type": "request", "id": "b", "name": "broken", "method": "GET", "url": "/boom"},
        ]}],
    }

class MonitorSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()

    def test_runs_due_projects_and_notifies(self):
        store = SimpleNamespace(projects=[_project(self.base, 5)], global_variables={})
        monitor = MonitorScheduler(store)
        with patch("backend.app.services.monitor.maybe_notify_discord") as notify:
            monitor.tick(now=1000)
        result = monitor.results["p1"]
        self.assertFalse(result["passed"], result)
        self.assertEqual(result["summary"], {"total": 2, "passed": 1, "failed": 1}, result["failures"])
        self.assertEqual([f["name"] for f in result["failures"]], ["broken"])
        self.assertEqual(notify.call_args.kwargs["stats"]["errors"], 1)

        # Not due again until the interval has passed.
        monitor.results.clear()
        monitor.tick(now=1000 + 299)
        self.assertNotIn("p1", monitor.results)
        monitor.tick(now=1000 + 300)
        self.assertIn("p1", monitor.results)

    def test_disabled_projects_are_skipped(self):
        store = SimpleNamespace(projects=[_project(self.base, 0)], global_variables={})
        monitor = MonitorScheduler(store)
        monitor.tick(now=1000)
        self.assertEqual(monitor.results, {})

if __name__ == "__main__":
    unittest.main()
