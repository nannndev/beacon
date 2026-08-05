"""Lifecycle coordination for asynchronous endpoint runs.

This service deliberately knows nothing about FastAPI. Routers validate HTTP
input, then hand the selected endpoint and normalized execution options here.
"""
from __future__ import annotations

import os
import threading
from typing import Callable, Optional

from ..core.tester import APITester
from ..history.models import RunStart, RunStepStart
from ..history.sanitize import sanitize_run_config
from . import runner


class EndpointRunCoordinator:
    def __init__(
        self,
        store,
        *,
        tester_factory: Callable = APITester,
        thread_factory: Callable = threading.Thread,
        events=runner,
    ):
        self.store = store
        self.tester_factory = tester_factory
        self.thread_factory = thread_factory
        self.events = events

    def start(
        self,
        test,
        *,
        mode: str,
        params: dict,
        request_config: dict,
        history_id: Optional[str] = None,
        history_step_index: int = 0,
    ) -> dict:
        run_id = os.urandom(8).hex()
        history_id = str(history_id or run_id)
        grouped_history = bool(request_config.get("history_id"))
        project = self._active_project()
        notification_settings = {} if grouped_history else project.get("notifications") or {}
        history_persisted = self._start_history(
            history_id, history_step_index, test, mode, request_config, project, grouped_history
        )

        stop_flag = {"stop": False}
        self.store.current_runs[run_id] = {
            "status": "running",
            "mode": mode,
            "logs": [],
            "responses": [],
            "stats": {"attempts": 0, "success": 0, "rate_limited": 0, "errors": 0},
            "stop_flag": stop_flag,
        }

        worker = self.thread_factory(
            target=lambda: self._execute(
                run_id=run_id,
                history_id=history_id,
                history_step_index=history_step_index,
                test=test,
                mode=mode,
                params=params,
                grouped_history=grouped_history,
                notification_settings=notification_settings,
                project_name=project.get("name"),
            ),
            daemon=True,
        )
        worker.start()
        return {
            "run_id": run_id,
            "mode": mode,
            "history_id": history_id if history_persisted else None,
        }

    def _active_project(self) -> dict:
        return next(
            (project for project in self.store.projects
             if project.get("id") == self.store.current_project_id),
            {"id": self.store.current_project_id or "unknown", "name": "Unknown project"},
        )

    def _start_history(
        self, history_id, step_index, test, mode, request_config, project, grouped_history
    ) -> bool:
        if grouped_history:
            return True
        return self.store.history.start(
            RunStart(
                id=history_id,
                workspace_id=self.store.history.workspace_id or "local",
                project_id=project.get("id") or "unknown",
                project_name=project.get("name") or "Unknown project",
                origin_device_id=self.store.history.origin_device_id or "local",
                source_type="endpoint",
                target_id=test.id,
                target_name=test.name,
                mode=mode,
                config_snapshot=sanitize_run_config(request_config, test),
            ),
            [RunStepStart(step_index, test.id, test.name, test.method, test.url)],
        )

    def _execute(
        self,
        *,
        run_id,
        history_id,
        history_step_index,
        test,
        mode,
        params,
        grouped_history,
        notification_settings,
        project_name,
    ) -> None:
        outcome = "completed"
        try:
            def on_stats(stats):
                self.store.history.record_stats(history_id, history_step_index, stats)
                self.events.dispatch(self.events.broadcast_stats(run_id, stats))

            def on_response(response):
                self.store.history.record_response(history_id, history_step_index, response)
                self.events.dispatch(self.events.broadcast_response(run_id, response))

            tester = self.tester_factory(
                test,
                self.store.current_config,
                concurrency=params["concurrency"],
                delay=params["delay"],
                max_requests=params["max_requests"],
                log_callback=lambda message: self.events.dispatch(
                    self.events.broadcast_log(run_id, message)
                ),
                stats_callback=on_stats,
                response_callback=on_response,
                stop_flag=self.store.current_runs[run_id]["stop_flag"],
            )
            results = tester.run_mode(mode, params)
            self.events.dispatch(self.events.broadcast_log(run_id, f"Finished: {results}"))
        except Exception as error:
            outcome = "failed"
            self.events.dispatch(self.events.broadcast_log(run_id, f"Error: {error}"))
        finally:
            self._finish(
                run_id, history_id, history_step_index, test, mode, outcome,
                grouped_history, notification_settings, project_name,
            )

    def _finish(
        self,
        run_id,
        history_id,
        history_step_index,
        test,
        mode,
        outcome,
        grouped_history,
        notification_settings,
        project_name,
    ) -> None:
        active_run = self.store.current_runs[run_id]
        if active_run["stop_flag"].get("stop"):
            outcome = "stopped"
        self.store.history.finish_step(history_id, history_step_index, outcome)
        if not grouped_history:
            self.store.history.finish_run(history_id, outcome)

        if outcome == "stopped":
            active_run["status"] = "stopped"
        elif active_run["status"] == "running":
            active_run["status"] = "finished"
        self.events.dispatch(self.events.broadcast_log(run_id, "run_finished"))
        self.events.dispatch(self.events.broadcast_stats(run_id, active_run["stats"]))
        self._notify(
            test, mode, active_run["stats"], outcome,
            grouped_history, notification_settings, project_name,
        )

    @staticmethod
    def _notify(
        test, mode, stats, outcome, grouped_history, notification_settings, project_name
    ) -> None:
        if grouped_history or not notification_settings:
            return
        try:
            from .notify_discord import maybe_notify as maybe_notify_discord
            from .notify_slack import maybe_notify as maybe_notify_slack

            maybe_notify_discord(
                notification_settings,
                target_name=test.name,
                mode=mode,
                stats=stats,
                outcome=outcome,
                project_name=project_name,
            )
            maybe_notify_slack(
                notification_settings,
                target_name=test.name,
                mode=mode,
                stats=stats,
                outcome=outcome,
                project_name=project_name,
            )
        except Exception:
            pass
