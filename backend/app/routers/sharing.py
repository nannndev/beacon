import copy
from dataclasses import asdict
import uuid

from fastapi import APIRouter, HTTPException, Query

from ..sharing.models import MutationConflict
from ..state import store
import requests


router = APIRouter(prefix="/sharing", tags=["sharing"])


def _not_found():
    return HTTPException(status_code=404, detail="Shared project not found")


@router.get("/projects/{project_id}")
def sharing_status(project_id: str):
    status = store.sharing.status(project_id)
    if not status:
        return {"project_id": project_id, "sharing_enabled": False, "revision": None, "host": {"hosting": False}}
    return status


@router.post("/projects/{project_id}/enable")
def enable_sharing(project_id: str):
    try:
        return store.sharing.enable(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Project not found")


@router.post("/projects/{project_id}/disable")
def disable_sharing(project_id: str):
    try:
        return store.sharing.disable(project_id)
    except KeyError:
        raise _not_found()


@router.post("/projects/{project_id}/pairing-code")
def refresh_pairing_code(project_id: str):
    try:
        return store.sharing.refresh_pairing_code(project_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.post("/join")
def join_local_project(data: dict):
    address = str(data.get("address", "")).strip()
    code = str(data.get("code", "")).strip()
    if not address or len(code) != 6 or not code.isdigit():
        raise HTTPException(status_code=400, detail="Host address and six-digit pairing code are required")
    try:
        return store.sharing.request_join(address, code, str(data.get("device_name") or "Beacon device"))
    except requests.RequestException as error:
        detail = "Could not connect to that Beacon host"
        if getattr(error, "response", None) is not None:
            try:
                detail = error.response.json().get("detail", detail)
            except ValueError:
                pass
        raise HTTPException(status_code=502, detail=detail)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.post("/join/status")
def joined_project_status(data: dict):
    try:
        result = store.sharing.complete_join(str(data.get("address", "")), str(data.get("request_id", "")))
        if result["status"] != "approved":
            return result
        project = result["project"]
        if any(item.get("id") == project.get("id") for item in store.projects):
            raise HTTPException(status_code=409, detail="This shared project already exists on this device")
        store.projects.append(project)
        store.current_project_id = project["id"]
        store.sync_current_config()
        store.save()
        return {"status": "approved", "project_id": project["id"], "project_name": project.get("name")}
    except HTTPException:
        raise
    except requests.RequestException as error:
        detail = "Could not connect to that Beacon host"
        if getattr(error, "response", None) is not None:
            try:
                detail = error.response.json().get("detail", detail)
            except ValueError:
                pass
        raise HTTPException(status_code=502, detail=detail)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.post("/projects/{project_id}/requests/{request_id}/decision")
def decide_pairing(project_id: str, request_id: str, data: dict):
    try:
        return store.sharing.decide_pairing(
            project_id, request_id, bool(data.get("approved")), str(data.get("role") or "viewer")
        )
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.patch("/projects/{project_id}/members/{device_id}")
def update_member(project_id: str, device_id: str, data: dict):
    try:
        return store.sharing.update_member(project_id, device_id, str(data.get("role") or ""))
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.delete("/projects/{project_id}/members/{device_id}")
def remove_member(project_id: str, device_id: str):
    try:
        return store.sharing.remove_member(project_id, device_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


def _joined_project(project_id: str) -> dict:
    project = next((item for item in store.projects if item.get("id") == project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.get("shared_origin"):
        raise HTTPException(status_code=400, detail="This project was not joined from another device")
    return project


@router.post("/projects/{project_id}/duplicate-private")
def duplicate_shared_project(project_id: str):
    source = copy.deepcopy(_joined_project(project_id))
    source["id"] = str(uuid.uuid4())
    source["name"] = f"{source.get('name', 'Shared project')} (Private copy)"
    source.pop("shared_origin", None)
    store.projects.append(source)
    store.current_project_id = source["id"]
    store.sync_current_config()
    store.save(sync_sharing=False)
    return {"project_id": source["id"], "project_name": source["name"]}


@router.post("/projects/{project_id}/leave")
def leave_shared_project(project_id: str):
    project = _joined_project(project_id)
    store.projects.remove(project)
    store.current_project_id = store.projects[0]["id"] if store.projects else None
    store.sync_current_config()
    store.save(sync_sharing=False)
    return {"left": True, "current_project_id": store.current_project_id}


@router.post("/projects/{project_id}/sync")
def sync_shared_project(project_id: str):
    project = next((item for item in store.projects if item.get("id") == project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    updated = store.sharing.pull_updates(project)
    if updated:
        index = store.projects.index(project)
        store.projects[index] = updated
        store.sync_current_config()
        store.save(sync_sharing=False)
    status = store.sharing.status(project_id)
    return {"changed": bool(updated), "status": status}


@router.get("/projects/{project_id}/watch")
def watch_shared_project(
    project_id: str, timeout: float = Query(5, ge=0.1, le=10),
    active_target_id: str = None, active_target_name: str = None, activity: str = None,
):
    project = _joined_project(project_id)
    updated = store.sharing.watch_updates(project, timeout, active_target_id, active_target_name, activity)
    if updated:
        store.projects[store.projects.index(project)] = updated
        store.sync_current_config()
        store.save(sync_sharing=False)
    return {"changed": bool(updated), "status": store.sharing.status(project_id)}


@router.post("/projects/{project_id}/conflict/{resolution}")
def resolve_shared_project_conflict(project_id: str, resolution: str, data: dict = None):
    project = _joined_project(project_id)
    try:
        updated = store.sharing.resolve_conflict(project, resolution, (data or {}).get("choices"))
        store.projects[store.projects.index(project)] = updated
        store.sync_current_config()
        store.save(sync_sharing=False)
        return {"resolved": True, "status": store.sharing.status(project_id)}
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Could not reach sharing host: {error}")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.get("/projects/{project_id}/snapshot")
def project_snapshot(project_id: str):
    snapshot = store.sharing.snapshot(project_id)
    if not snapshot:
        raise _not_found()
    return snapshot


@router.get("/projects/{project_id}/revisions")
def project_revisions(project_id: str, after: int = Query(0, ge=0)):
    if not store.sharing.status(project_id):
        raise _not_found()
    return {"items": store.sharing.revisions_after(project_id, after)}


@router.post("/projects/{project_id}/mutations")
def apply_mutation(project_id: str, data: dict):
    if data.get("project_id") not in {None, project_id}:
        raise HTTPException(status_code=400, detail="project_id does not match route")
    try:
        revision = store.sharing.mutate({**data, "project_id": project_id})
        return asdict(revision)
    except MutationConflict as conflict:
        raise HTTPException(status_code=409, detail=conflict.to_dict())
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))
