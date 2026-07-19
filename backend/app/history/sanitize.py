"""Allowlist-only projections for durable history."""

from typing import Any

from ..core.tester import EndpointTest
from .models import RunEvent


RUN_CONFIG_KEYS = {
    "mode",
    "concurrency",
    "delay",
    "max_requests",
    "use_min_delay",
    "ramp_start",
    "ramp_end",
    "ramp_step_duration",
    "baseline_workers",
    "peak_workers",
    "baseline_requests",
    "peak_requests",
    "recovery_requests",
    "duration_s",
    "rps",
    "start_rps",
    "step_rps",
    "step_requests",
    "max_rps",
    "n_samples",
    "warmup",
}


def _safe_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (bool, int, float, str))


def sanitize_run_config(payload: dict, endpoint: EndpointTest) -> dict:
    """Keep execution controls and endpoint templates; discard all request data."""
    result = {
        key: payload[key]
        for key in RUN_CONFIG_KEYS
        if key in payload and _safe_scalar(payload[key])
    }
    fuzz_fields = payload.get("fuzz_fields")
    if isinstance(fuzz_fields, list):
        result["fuzz_fields"] = [
            str(field)[:80]
            for field in fuzz_fields
            if isinstance(field, str)
        ][:50]
    result["method"] = endpoint.method
    result["url_template"] = endpoint.url
    return result


def _error_category(raw_error: Any) -> str:
    text = str(raw_error or "").lower()
    if "timeout" in text or "timed out" in text:
        return "timeout"
    if "ssl" in text or "tls" in text or "certificate" in text:
        return "tls"
    if "connect" in text or "network" in text or "dns" in text:
        return "connection"
    if "json" in text or "decode" in text:
        return "invalid_response"
    return "request_error"


def sanitize_response_event(response: dict, elapsed_ms: int) -> RunEvent:
    """Convert a runner response into a bounded event without copying raw text."""
    status = response.get("status")
    try:
        status = int(status) if status is not None else None
    except (TypeError, ValueError):
        status = None
    latency = response.get("time_ms", response.get("time"))
    try:
        latency = float(latency) if latency is not None else None
    except (TypeError, ValueError):
        latency = None

    if response.get("rate_limited") or status == 429:
        outcome = "rate_limited"
    elif response.get("success") is True or (status is not None and 200 <= status < 300):
        outcome = "success"
    else:
        outcome = "error"
    category = _error_category(response.get("error")) if outcome == "error" else None
    return RunEvent(
        elapsed_ms=max(0, int(elapsed_ms)),
        outcome=outcome,
        status_code=status,
        latency_ms=latency,
        error_category=category,
        message=None,
    )
