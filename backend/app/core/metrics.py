"""Thread-safe run counters, latency samples, and operational snapshots."""
from __future__ import annotations

import time
from typing import Dict, List, Optional


def percentile(sorted_values: List[float], percentage: float) -> float:
    count = len(sorted_values)
    if count == 0: return 0.0
    if count == 1: return sorted_values[0]
    rank = percentage / 100.0 * (count - 1)
    lower = int(rank)
    upper = min(lower + 1, count - 1)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (rank - lower)


class RunMetrics:
    def __init__(self):
        self.reset()

    def reset(self):
        self.results = {"attempts": 0, "success": 0, "rate_limited": 0, "errors": 0,
                        "ws_messages_sent": 0, "ws_messages_received": 0, "ws_disconnects": 0}
        self.status_codes: Dict[str, int] = {}
        self.recent_ms: List[int] = []
        self.all_latencies: List[float] = []
        self.latency = {"sum": 0.0, "count": 0, "min": 0.0, "max": 0.0, "last": 0.0}
        self.first_rate_limited_at: Optional[int] = None
        self.last_retry_after: Optional[str] = None
        self.probe_threshold_rps: Optional[float] = None
        self.capacity_safe_rps: Optional[float] = None
        self.capacity_breaking_rps: Optional[float] = None
        self.capacity_breach_reason: Optional[str] = None
        self.started_at = time.time()

    def record_latency(self, milliseconds: float):
        latency = self.latency
        latency["sum"] += milliseconds
        latency["count"] += 1
        latency["last"] = milliseconds
        latency["min"] = milliseconds if latency["count"] == 1 else min(latency["min"], milliseconds)
        latency["max"] = max(latency["max"], milliseconds)
        self.recent_ms.append(round(milliseconds))
        del self.recent_ms[:-60]
        self.all_latencies.append(milliseconds)

    def record_response(self, status_code: int, milliseconds: float, rate_limited: bool,
                        retry_after: Optional[str] = None):
        self.results["attempts"] += 1
        if 200 <= status_code < 300:
            self.results["success"] += 1
        elif rate_limited:
            self.results["rate_limited"] += 1
            if self.first_rate_limited_at is None:
                self.first_rate_limited_at = self.results["attempts"]
            if retry_after:
                self.last_retry_after = retry_after
        else:
            self.results["errors"] += 1
        key = str(status_code)
        self.status_codes[key] = self.status_codes.get(key, 0) + 1
        self.record_latency(milliseconds)

    def record_error(self):
        self.results["attempts"] += 1
        self.results["errors"] += 1
        self.status_codes["error"] = self.status_codes.get("error", 0) + 1

    def record_ws_message_sent(self):
        self.results["ws_messages_sent"] += 1

    def record_ws_message_received(self):
        self.results["ws_messages_received"] += 1

    def record_ws_disconnect(self):
        self.results["ws_disconnects"] += 1

    def snapshot(self) -> Dict:
        latency = self.latency
        count = latency["count"]
        elapsed = max(time.time() - self.started_at, 1e-9)
        sorted_latencies = sorted(self.all_latencies)
        result = dict(self.results)
        result["status_codes"] = dict(self.status_codes)
        result["recent_ms"] = list(self.recent_ms)
        result["latency_ms"] = {
            "avg": round(latency["sum"] / count) if count else 0,
            "min": round(latency["min"]), "max": round(latency["max"]), "last": round(latency["last"]),
            "p50": round(percentile(sorted_latencies, 50)), "p75": round(percentile(sorted_latencies, 75)),
            "p90": round(percentile(sorted_latencies, 90)), "p95": round(percentile(sorted_latencies, 95)),
            "p99": round(percentile(sorted_latencies, 99)), "p999": round(percentile(sorted_latencies, 99.9)),
        }
        result["elapsed_s"] = round(elapsed, 2)
        result["rps"] = round(self.results["attempts"] / elapsed, 1)
        result["first_rate_limited_at"] = self.first_rate_limited_at
        result["retry_after"] = self.last_retry_after
        result["probe_threshold_rps"] = self.probe_threshold_rps
        result["capacity_safe_rps"] = self.capacity_safe_rps
        result["capacity_breaking_rps"] = self.capacity_breaking_rps
        result["capacity_breach_reason"] = self.capacity_breach_reason
        return result
