"""Failure-isolated active-run recorder and aggregation service."""

import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from .compare import percentile
from .models import RunEvent, RunMetrics, RunSample, RunStart, RunStepStart
from .sanitize import sanitize_response_event


SAMPLE_CAP = 300
EVENT_CAP = 200


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
        self.workspace_id: Optional[str] = None
        self.origin_device_id: Optional[str] = None
        self._active: dict[str, _RunBuffer] = {}
        self._lock = threading.RLock()

    def _disable(self) -> None:
        self.available = False
        self.error_code = "history_unavailable"

    def initialize(self) -> None:
        try:
            self.repository.initialize()
            metadata = self.repository.metadata()
            self.workspace_id = metadata["workspace_id"]
            self.origin_device_id = metadata["origin_device_id"]
            self.available = True
            self.error_code = None
        except Exception:
            self._disable()

    def start(self, run: RunStart, steps: list[RunStepStart]) -> bool:
        if not self.available:
            return False
        try:
            self.repository.create_run(run, steps)
            with self._lock:
                self._active[run.id] = _RunBuffer(
                    project_id=run.project_id,
                    started_monotonic=time.monotonic(),
                    steps={step.sequence: _StepBuffer() for step in steps},
                )
            return True
        except Exception:
            self._disable()
            return False

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
            self._disable()

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
            self._disable()

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
            self.repository.finalize_step(run_id, step_index, status, metrics)
        except Exception:
            self._disable()

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
            self.repository.finalize_run(run_id, status, metrics, samples, events)
            if status == "completed":
                self.repository.enforce_retention(buffer.project_id)
        except Exception:
            self._disable()
