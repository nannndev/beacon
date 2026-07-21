"""Failure-isolated active-run recorder and aggregation service."""

import sqlite3
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from .compare import percentile
from .models import RunEvent, RunMetrics, RunSample, RunStart, RunStepStart
from .sanitize import sanitize_response_event


SAMPLE_CAP = 300
EVENT_CAP = 200

# Retry policy for transient SQLite contention (WAL locks when another process
# or thread holds the DB briefly). Short exponential backoff; the repository
# already sets busy_timeout=5s, so this only kicks in on genuine cross-process
# contention that outlives that window.
_MAX_ATTEMPTS = 4
_BACKOFF_BASE = 0.05

# Substrings that mark a genuinely broken database file (a rebuild IS required)
# vs. a transient lock (retry, don't nuke history).
_CORRUPT_MARKERS = (
    "malformed", "corrupt", "not a database",
    "file is encrypted", "encrypted or is not a database",
)
_TRANSIENT_MARKERS = ("locked", "busy")


def _classify_error(err: Exception) -> str:
    """Bucket a failure so the service can react proportionately:
    - "input":     caller error (bad cursor, etc.) — never a storage fault.
    - "transient": DB briefly locked/busy — retry, keep history alive.
    - "corrupt":   the DB file is broken — only this warrants a reset.
    - "other":     unknown — disable but allow later auto-recovery.
    """
    if isinstance(err, (ValueError, TypeError, KeyError)):
        return "input"
    message = str(err).lower()
    if any(marker in message for marker in _CORRUPT_MARKERS):
        return "corrupt"
    if isinstance(err, sqlite3.OperationalError) and any(
        marker in message for marker in _TRANSIENT_MARKERS
    ):
        return "transient"
    return "other"


@dataclass
class _StepBuffer:
    latest_stats: dict = field(default_factory=dict)
    latencies: list[float] = field(default_factory=list)
    status: str = "pending"


@dataclass
class _RunBuffer:
    project_id: str
    started_monotonic: float
    steps: dict[int, _StepBuffer] = field(default_factory=dict)
    samples: list[RunSample] = field(default_factory=list)
    events: list[RunEvent] = field(default_factory=list)
    last_sample_elapsed: Optional[int] = None
    last_sample_attempts: int = 0


def _append_downsampled(values: list, value, cap: int) -> None:
    values.append(value)
    if len(values) > cap:
        reduced = values[::2]
        if reduced[-1] is not values[-1]:
            reduced.append(values[-1])
        values[:] = reduced


class HistoryService:
    def __init__(self, repository):
        self.repository = repository
        self.available = True
        self.error_code: Optional[str] = None
        # Whether the last disable was due to genuine corruption. Fatal =>
        # only an explicit rebuild recovers; non-fatal => auto-recover on the
        # next request. This is the flag that stops the "reset forever" trap.
        self._fatal = False
        self.workspace_id: Optional[str] = None
        self.origin_device_id: Optional[str] = None
        self._active: dict[str, _RunBuffer] = {}
        self._lock = threading.RLock()

    def _disable(self, *, fatal: bool = False) -> None:
        self.available = False
        self.error_code = "history_corrupt" if fatal else "history_unavailable"
        self._fatal = fatal

    def _attempt(self, operation):
        """Run a repository call with transient-lock retries and proportionate
        failure handling. Re-raises on failure; the caller decides what to
        return. Only real corruption permanently disables history — a transient
        lock that outlasts our retries leaves `available` untouched so the very
        next request succeeds instead of hitting a dead service."""
        delay = _BACKOFF_BASE
        for attempt in range(_MAX_ATTEMPTS):
            try:
                return operation()
            except Exception as err:
                kind = _classify_error(err)
                if kind == "input":
                    raise  # caller/input error — not a storage failure
                if kind == "transient" and attempt < _MAX_ATTEMPTS - 1:
                    time.sleep(delay)
                    delay *= 2
                    continue
                if kind == "corrupt":
                    self._disable(fatal=True)
                elif kind == "other":
                    self._disable(fatal=False)
                # transient exhaustion: deliberately do NOT disable.
                raise

    def _recover_if_possible(self) -> bool:
        """Return True if history can serve a request now, re-opening a
        non-fatally-disabled database on demand. Genuine corruption stays down
        until an explicit rebuild."""
        if self.available:
            return True
        if self._fatal:
            return False
        self.initialize()
        return self.available

    def initialize(self) -> None:
        try:
            self._attempt(self.repository.initialize)
            metadata = self._attempt(self.repository.metadata)
            self.workspace_id = metadata["workspace_id"]
            self.origin_device_id = metadata["origin_device_id"]
            self.available = True
            self.error_code = None
            self._fatal = False
        except Exception:
            # _attempt already set corrupt/other state; if it was transient
            # exhaustion it left us "available", so mark a recoverable outage.
            if self.available:
                self._disable(fatal=False)

    def mark_interrupted_runs(self) -> int:
        if not self.origin_device_id or not self._recover_if_possible():
            return 0
        try:
            return self._attempt(lambda: self.repository.mark_interrupted(self.origin_device_id))
        except Exception:
            return 0

    def start(self, run: RunStart, steps: list[RunStepStart]) -> bool:
        if not self._recover_if_possible():
            return False
        try:
            self._attempt(lambda: self.repository.create_run(run, steps))
        except Exception:
            return False
        with self._lock:
            self._active[run.id] = _RunBuffer(
                project_id=run.project_id,
                started_monotonic=time.monotonic(),
                steps={step.sequence: _StepBuffer() for step in steps},
            )
        return True

    def _elapsed(self, buffer: _RunBuffer, elapsed_ms: Optional[int]) -> int:
        if elapsed_ms is not None:
            return max(0, int(elapsed_ms))
        return max(0, int((time.monotonic() - buffer.started_monotonic) * 1000))

    def record_stats(self, run_id: str, step_index: int, stats: dict, elapsed_ms: Optional[int] = None) -> None:
        if not self.available:
            return
        try:
            with self._lock:
                buffer = self._active.get(run_id)
                if buffer is None:
                    return
                step = buffer.steps.setdefault(step_index, _StepBuffer())
                step.latest_stats = {
                    key: int(stats.get(key, 0) or 0)
                    for key in ("attempts", "success", "rate_limited", "errors")
                }
                elapsed = self._elapsed(buffer, elapsed_ms)
                totals = self._total_stats(buffer)
                delta_attempts = totals["attempts"] - buffer.last_sample_attempts
                delta_elapsed = (
                    elapsed - buffer.last_sample_elapsed
                    if buffer.last_sample_elapsed is not None
                    else elapsed
                )
                rps = delta_attempts * 1000 / delta_elapsed if delta_elapsed > 0 else 0.0
                recent_latency = step.latencies[-1] if step.latencies else None
                sample = RunSample(
                    sequence=len(buffer.samples),
                    elapsed_ms=elapsed,
                    attempts=totals["attempts"],
                    success=totals["success"],
                    rate_limited=totals["rate_limited"],
                    errors=totals["errors"],
                    instantaneous_rps=rps,
                    latency_ms=recent_latency,
                )
                _append_downsampled(buffer.samples, sample, SAMPLE_CAP)
                buffer.last_sample_elapsed = elapsed
                buffer.last_sample_attempts = totals["attempts"]
        except Exception:
            self._disable(fatal=False)

    def record_response(self, run_id: str, step_index: int, response: dict, elapsed_ms: Optional[int] = None) -> None:
        if not self.available:
            return
        try:
            with self._lock:
                buffer = self._active.get(run_id)
                if buffer is None:
                    return
                step = buffer.steps.setdefault(step_index, _StepBuffer())
                elapsed = self._elapsed(buffer, elapsed_ms)
                event = sanitize_response_event(response, elapsed)
                if event.latency_ms is not None:
                    step.latencies.append(event.latency_ms)
                _append_downsampled(buffer.events, event, EVENT_CAP)
        except Exception:
            self._disable(fatal=False)

    @staticmethod
    def _total_stats(buffer: _RunBuffer) -> dict[str, int]:
        return {
            key: sum(step.latest_stats.get(key, 0) for step in buffer.steps.values())
            for key in ("attempts", "success", "rate_limited", "errors")
        }

    @staticmethod
    def _metrics(buffer: _RunBuffer, step_index: Optional[int] = None) -> RunMetrics:
        steps = (
            [buffer.steps.get(step_index, _StepBuffer())]
            if step_index is not None
            else list(buffer.steps.values())
        )
        stats = {
            key: sum(step.latest_stats.get(key, 0) for step in steps)
            for key in ("attempts", "success", "rate_limited", "errors")
        }
        latencies = [latency for step in steps for latency in step.latencies]
        rps_values = [sample.instantaneous_rps for sample in buffer.samples]
        return RunMetrics(
            **stats,
            average_rps=(sum(rps_values) / len(rps_values)) if rps_values else 0.0,
            peak_rps=max(rps_values, default=0.0),
            min_latency_ms=min(latencies) if latencies else None,
            average_latency_ms=(sum(latencies) / len(latencies)) if latencies else None,
            p50_ms=percentile(latencies, 0.50),
            p95_ms=percentile(latencies, 0.95),
            p99_ms=percentile(latencies, 0.99),
            max_latency_ms=max(latencies) if latencies else None,
        )

    def finish_step(self, run_id: str, step_index: int, status: str) -> None:
        if not self.available:
            return
        try:
            with self._lock:
                buffer = self._active.get(run_id)
                if buffer is None:
                    return
                buffer.steps.setdefault(step_index, _StepBuffer()).status = status
                metrics = self._metrics(buffer, step_index)
            self._attempt(lambda: self.repository.finalize_step(run_id, step_index, status, metrics))
            with self._lock:
                active = self._active.get(run_id)
                statuses = [step.status for step in active.steps.values()] if active else []
            if statuses and all(value != "pending" for value in statuses):
                final_status = (
                    "failed" if "failed" in statuses
                    else "stopped" if "stopped" in statuses
                    else "completed"
                )
                self.finish_run(run_id, final_status)
        except Exception:
            pass  # _attempt already set the right state; never lose a run silently forever

    def finish_run(self, run_id: str, status: str) -> None:
        if not self.available:
            return
        try:
            with self._lock:
                buffer = self._active.pop(run_id, None)
                if buffer is None:
                    return
                metrics = self._metrics(buffer)
                samples = list(buffer.samples)
                events = list(buffer.events)
            self._attempt(lambda: self.repository.finalize_run(run_id, status, metrics, samples, events))
            if status == "completed":
                # Retention is best-effort housekeeping — a failure here must
                # not disable history or mask a successfully-recorded run.
                try:
                    self._attempt(lambda: self.repository.enforce_retention(buffer.project_id))
                except Exception:
                    pass
        except Exception:
            pass

    def list_runs(self, filters=None, cursor=None, limit=30):
        if not self._recover_if_possible():
            raise RuntimeError("history_unavailable")
        try:
            return self._attempt(lambda: self.repository.list_runs(filters or {}, cursor, limit))
        except ValueError:
            raise  # invalid cursor → 400, not a storage failure
        except Exception:
            raise RuntimeError("history_unavailable") from None

    def get_run(self, run_id: str):
        if not self._recover_if_possible():
            raise RuntimeError("history_unavailable")
        try:
            return self._attempt(lambda: self.repository.get_run(run_id))
        except Exception:
            raise RuntimeError("history_unavailable") from None

    def compare(self, baseline_id: str, candidate_id: str):
        from .compare import compare_details

        if not self._recover_if_possible():
            raise RuntimeError("history_unavailable")
        try:
            baseline = self._attempt(lambda: self.repository.get_run(baseline_id))
            candidate = self._attempt(lambda: self.repository.get_run(candidate_id))
        except Exception:
            raise RuntimeError("history_unavailable") from None
        if baseline is None or candidate is None:
            return None
        return compare_details(baseline, candidate)

    def update_run(self, run_id: str, label=None, is_pinned=None):
        if not self._recover_if_possible():
            raise RuntimeError("history_unavailable")
        try:
            return self._attempt(lambda: self.repository.update_run(run_id, label=label, is_pinned=is_pinned))
        except Exception:
            raise RuntimeError("history_unavailable") from None

    def delete_run(self, run_id: str):
        if not self._recover_if_possible():
            raise RuntimeError("history_unavailable")
        try:
            return self._attempt(lambda: self.repository.delete_run(run_id))
        except Exception:
            raise RuntimeError("history_unavailable") from None

    def health(self) -> dict:
        # Opportunistically self-heal a non-fatal outage so the UI banner clears
        # on its own once the transient condition (e.g. a lock) has passed —
        # the user shouldn't have to reset for something that already recovered.
        self._recover_if_possible()
        try:
            backup_available = self.repository.backup_exists()
        except Exception:
            backup_available = False
        return {
            "available": self.available,
            "error_code": self.error_code,
            "backup_available": backup_available,
        }

    def rebuild(self) -> None:
        try:
            self.repository.rebuild()
            self.initialize()
        except Exception:
            self._disable(fatal=True)
