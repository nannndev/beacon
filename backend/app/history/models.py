"""Sanitized immutable records accepted by the history repository."""

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass(frozen=True)
class RunStart:
    id: str
    workspace_id: str
    project_id: str
    project_name: str
    origin_device_id: str
    source_type: str
    target_id: Optional[str]
    target_name: str
    mode: str
    config_snapshot: dict[str, Any] = field(default_factory=dict)
    label: Optional[str] = None
    is_pinned: bool = False


@dataclass(frozen=True)
class RunStepStart:
    sequence: int
    endpoint_id: str
    endpoint_name: str
    method: str
    url_template: str


@dataclass(frozen=True)
class RunMetrics:
    attempts: int = 0
    success: int = 0
    rate_limited: int = 0
    errors: int = 0
    average_rps: float = 0.0
    peak_rps: float = 0.0
    min_latency_ms: Optional[float] = None
    average_latency_ms: Optional[float] = None
    p50_ms: Optional[float] = None
    p95_ms: Optional[float] = None
    p99_ms: Optional[float] = None
    max_latency_ms: Optional[float] = None


@dataclass(frozen=True)
class RunSample:
    sequence: int
    elapsed_ms: int
    attempts: int
    success: int
    rate_limited: int
    errors: int
    instantaneous_rps: float
    latency_ms: Optional[float] = None


@dataclass(frozen=True)
class RunEvent:
    elapsed_ms: int
    outcome: str
    status_code: Optional[int] = None
    latency_ms: Optional[float] = None
    error_category: Optional[str] = None
    message: Optional[str] = None
