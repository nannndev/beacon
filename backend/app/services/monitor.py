"""Scheduled monitor: re-run a project's requests every N minutes.

The interval lives on the project's notifications settings as
`notifications.monitor_minutes` (0 = off), so it inherits their handling:
device-local, stripped from shared sources, kept across sharing pulls.
Each check runs every request once through the CLI runner (same assertions
and auth as the desktop app) and reports through the existing Discord/Slack
notifiers, which honour the project's off / on_failure / always mode.
"""
import threading
import time

from ..cli_runner import _flatten_requests, run_project
from .notify_discord import maybe_notify as maybe_notify_discord
from .notify_slack import maybe_notify as maybe_notify_slack

TICK_SECONDS = 30

def check_project(project: dict, global_variables: dict) -> dict:
    """Run every request in the project once; return a summary for the UI."""
    environments = project.get("environments") or []
    env = next(
        (e for e in environments if e.get("id") == project.get("current_environment_id")),
        environments[0] if environments else None,
    )
    variables = {**(global_variables or {}), **((env or {}).get("variables") or {})}
    endpoints = _flatten_requests(project.get("items") or [])
    result = run_project(project, endpoints, env, variables, scope="monitor")
    summary = result.summary
    stats = {
        "attempts": summary["total"],
        "success": summary["passed"],
        "rate_limited": sum(1 for e in result.executions if e.status == 429),
        "errors": summary["failed"],
    }
    settings = project.get("notifications") or {}
    for notify in (maybe_notify_discord, maybe_notify_slack):
        notify(
            settings, target_name=project.get("name") or "Project", mode="monitor",
            stats=stats, outcome="completed", project_name=project.get("name"),
        )
    return {
        "checked_at": result.started_at,
        "passed": result.passed,
        "summary": summary,
        "failures": [
            {"name": e.endpoint_name, "error": e.error}
            for e in result.executions if not e.passed
        ][:20],
    }

class MonitorScheduler:
    def __init__(self, store):
        self.store = store
        self.last_run: dict[str, float] = {}
        self.results: dict[str, dict] = {}
        self._thread = None

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, daemon=True, name="beacon-monitor")
            self._thread.start()

    def _loop(self) -> None:
        while True:
            time.sleep(TICK_SECONDS)
            try:
                self.tick()
            except Exception:
                pass  # a broken check must never kill the scheduler

    def tick(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        for project in list(self.store.projects):
            minutes = (project.get("notifications") or {}).get("monitor_minutes") or 0
            pid = project.get("id")
            if minutes <= 0 or now - self.last_run.get(pid, 0) < minutes * 60:
                continue
            self.last_run[pid] = now
            try:
                self.results[pid] = check_project(project, self.store.global_variables)
            except Exception as error:
                self.results[pid] = {
                    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                    "passed": False, "summary": None, "failures": [], "error": str(error),
                }
