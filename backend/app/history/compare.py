"""Pure metric and time-series comparison helpers."""

import math
from typing import Optional


LOWER_IS_BETTER = {
    "min_latency_ms",
    "average_latency_ms",
    "p50_ms",
    "p95_ms",
    "p99_ms",
    "max_latency_ms",
    "errors",
    "rate_limited",
}
HIGHER_IS_BETTER = {"success", "average_rps", "peak_rps", "rps"}


def percentile(values: list[float], quantile: float) -> Optional[float]:
    clean = sorted(float(value) for value in values if value is not None and math.isfinite(float(value)))
    if not clean:
        return None
    if len(clean) == 1:
        return clean[0]
    q = max(0.0, min(1.0, float(quantile)))
    position = (len(clean) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return clean[lower]
    fraction = position - lower
    return clean[lower] + (clean[upper] - clean[lower]) * fraction


def _delta(metric: str, baseline, candidate) -> dict:
    if baseline is None or candidate is None:
        return {"value": candidate, "change": None, "percent_change": None, "improved": None}
    change = candidate - baseline
    percent_change = (change / baseline * 100) if baseline != 0 else None
    if metric in LOWER_IS_BETTER:
        improved = change < 0
    elif metric in HIGHER_IS_BETTER:
        improved = change > 0
    else:
        improved = None
    return {
        "value": candidate,
        "change": change,
        "percent_change": percent_change,
        "improved": improved,
    }


def _nearest_value(samples: list[dict], elapsed_ms: int, field: str):
    eligible = [sample for sample in samples if sample.get("elapsed_ms", 0) <= elapsed_ms]
    if not eligible:
        return None
    return eligible[-1].get(field)


def _align_series(baseline: list[dict], candidate: list[dict]) -> list[dict]:
    if not baseline or not candidate:
        return []
    baseline = sorted(baseline, key=lambda sample: sample.get("elapsed_ms", 0))
    candidate = sorted(candidate, key=lambda sample: sample.get("elapsed_ms", 0))
    cutoff = min(baseline[-1].get("elapsed_ms", 0), candidate[-1].get("elapsed_ms", 0))
    source = baseline if baseline[-1].get("elapsed_ms", 0) <= candidate[-1].get("elapsed_ms", 0) else candidate
    result = []
    for sample in source:
        elapsed = int(sample.get("elapsed_ms", 0))
        if elapsed > cutoff:
            break
        result.append(
            {
                "elapsed_ms": elapsed,
                "baseline_rps": _nearest_value(baseline, elapsed, "instantaneous_rps"),
                "candidate_rps": _nearest_value(candidate, elapsed, "instantaneous_rps"),
                "baseline_latency_ms": _nearest_value(baseline, elapsed, "latency_ms"),
                "candidate_latency_ms": _nearest_value(candidate, elapsed, "latency_ms"),
            }
        )
    return result


def compare_details(baseline: dict, candidate: dict) -> dict:
    baseline_metrics = baseline.get("metrics") or {}
    candidate_metrics = candidate.get("metrics") or {}
    metric_names = sorted(set(baseline_metrics) | set(candidate_metrics))
    return {
        "baseline": baseline,
        "candidate": candidate,
        "same_mode": baseline.get("mode") == candidate.get("mode"),
        "deltas": {
            metric: _delta(metric, baseline_metrics.get(metric), candidate_metrics.get(metric))
            for metric in metric_names
            if metric != "run_id"
        },
        "config_changes": {
            key: {
                "baseline": (baseline.get("config_snapshot") or {}).get(key),
                "candidate": (candidate.get("config_snapshot") or {}).get(key),
            }
            for key in sorted(
                set(baseline.get("config_snapshot") or {})
                | set(candidate.get("config_snapshot") or {})
            )
            if (baseline.get("config_snapshot") or {}).get(key)
            != (candidate.get("config_snapshot") or {}).get(key)
        },
        "series": _align_series(
            baseline.get("samples") or [], candidate.get("samples") or []
        ),
    }
