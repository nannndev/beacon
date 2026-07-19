"""Privacy-safe Run History REST API."""

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..history.models import RunStart, RunStepStart
from ..history.sanitize import RUN_CONFIG_KEYS
from ..state import store


router = APIRouter(prefix="/history", tags=["history"])
VALID_STATUSES = {"running", "completed", "stopped", "failed", "interrupted"}
VALID_SOURCES = {"endpoint", "folder", "run_all", "scenario"}


def _require_history():
    if not store.history.available:
        raise HTTPException(status_code=503, detail="Run history is unavailable")
    return store.history


@router.get("")
def list_history(
    project_id: Optional[str] = None,
    mode: Optional[str] = None,
    status: Optional[str] = None,
    source_type: Optional[str] = None,
    pinned: Optional[bool] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: int = Query(30, ge=1, le=100),
):
    if status and status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid history status")
    if source_type and source_type not in VALID_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid history source type")
    filters = {
        key: value
        for key, value in {
            "project_id": project_id,
            "mode": mode,
            "status": status,
            "source_type": source_type,
            "pinned": pinned,
            "date_from": date_from,
            "date_to": date_to,
            "search": search,
        }.items()
        if value is not None
    }
    try:
        return _require_history().list_runs(filters, cursor, max(1, min(int(limit), 100)))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid history cursor")


@router.get("/health")
def history_health():
    return store.history.health()


@router.post("/rebuild")
def rebuild_history(data: dict):
    if data.get("confirm") != "RESET HISTORY":
        raise HTTPException(status_code=400, detail="Type RESET HISTORY to confirm")
    store.history.rebuild()
    if not store.history.available:
        raise HTTPException(status_code=503, detail="Run history could not be rebuilt")
    return {"status": "rebuilt"}


@router.post("/compare")
def compare_history(data: dict):
    baseline_id = data.get("baseline_id")
    candidate_id = data.get("candidate_id")
    if not baseline_id or not candidate_id:
        raise HTTPException(status_code=400, detail="baseline_id and candidate_id are required")
    if baseline_id == candidate_id:
        raise HTTPException(status_code=400, detail="Choose two different runs")
    result = _require_history().compare(str(baseline_id), str(candidate_id))
    if result is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return result


@router.post("/groups")
def create_history_group(data: dict):
    source_type = str(data.get("source_type") or "run_all")
    if source_type not in {"folder", "run_all"}:
        raise HTTPException(status_code=400, detail="Invalid group source type")
    endpoint_ids = data.get("endpoint_ids")
    if not isinstance(endpoint_ids, list) or not endpoint_ids:
        raise HTTPException(status_code=400, detail="endpoint_ids must be a non-empty list")
    endpoints = {endpoint.id: endpoint for endpoint in store.current_config.tests}
    missing = [endpoint_id for endpoint_id in endpoint_ids if endpoint_id not in endpoints]
    if missing:
        raise HTTPException(status_code=404, detail="One or more endpoints were not found")
    project = next(
        (item for item in store.projects if item.get("id") == store.current_project_id),
        {"id": store.current_project_id or "unknown", "name": "Unknown project"},
    )
    history_id = str(uuid.uuid4())
    config_snapshot = {
        key: data[key]
        for key in RUN_CONFIG_KEYS
        if key in data and isinstance(data[key], (str, int, float, bool))
    }
    config_snapshot["mode"] = str(data.get("mode") or "load")
    steps = [
        RunStepStart(index, endpoints[endpoint_id].id, endpoints[endpoint_id].name,
                     endpoints[endpoint_id].method, endpoints[endpoint_id].url)
        for index, endpoint_id in enumerate(endpoint_ids)
    ]
    created = _require_history().start(
        RunStart(
            id=history_id,
            workspace_id=store.history.workspace_id or "local",
            project_id=project.get("id") or "unknown",
            project_name=project.get("name") or "Unknown project",
            origin_device_id=store.history.origin_device_id or "local",
            source_type=source_type,
            target_id=data.get("target_id"),
            target_name=str(data.get("target_name") or "Run all endpoints"),
            mode=config_snapshot["mode"],
            config_snapshot=config_snapshot,
        ),
        steps,
    )
    if not created:
        raise HTTPException(status_code=503, detail="Run history is unavailable")
    return {"history_id": history_id}


@router.post("/{run_id}/finish")
def finish_history_group(run_id: str, data: dict):
    status = data.get("status")
    if status not in {"stopped", "failed"}:
        raise HTTPException(status_code=400, detail="Group finish status must be stopped or failed")
    _require_history().finish_run(run_id, status)
    return {"status": status}


@router.get("/{run_id}/export")
def export_history(run_id: str):
    detail = _require_history().get_run(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Run not found")
    run_keys = {
        "id", "workspace_id", "project_id", "project_name", "origin_device_id",
        "source_type", "target_id", "target_name", "mode", "status", "label",
        "is_pinned", "started_at", "completed_at", "duration_ms",
        "config_snapshot", "schema_version", "revision",
    }
    return {
        "format": "beacon.run-history",
        "version": 1,
        "run": {key: detail.get(key) for key in run_keys},
        "metrics": detail.get("metrics") or {},
        "steps": detail.get("steps") or [],
        "samples": detail.get("samples") or [],
        "events": detail.get("events") or [],
    }


@router.get("/{run_id}")
def get_history(run_id: str):
    detail = _require_history().get_run(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return detail


@router.patch("/{run_id}")
def update_history(run_id: str, data: dict):
    unknown = set(data) - {"label", "is_pinned"}
    if unknown:
        raise HTTPException(status_code=400, detail="Only label and is_pinned can be updated")
    if not _require_history().update_run(
        run_id,
        label=data.get("label") if "label" in data else None,
        is_pinned=data.get("is_pinned") if "is_pinned" in data else None,
    ):
        raise HTTPException(status_code=404, detail="Run not found")
    return get_history(run_id)


@router.delete("/{run_id}")
def delete_history(run_id: str):
    if not _require_history().delete_run(run_id):
        raise HTTPException(status_code=404, detail="Run not found")
    return {"status": "deleted"}
