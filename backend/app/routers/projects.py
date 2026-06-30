import uuid

from fastapi import APIRouter, HTTPException

from ..state import store
from ..core.tester import EndpointTest

router = APIRouter(tags=["projects"])

# Portable project file format (Postman-style export/import envelope).
EXPORT_FORMAT = "security-tools.project"
EXPORT_VERSION = 1


@router.get("/projects")
def list_projects():
    store.save_active_project()
    return {
        "current_project_id": store.current_project_id,
        "projects": [
            {
                "id": p["id"],
                "name": p["name"],
                "environments": p.get("environments", []),
                "current_environment_id": p.get("current_environment_id"),
            }
            for p in store.projects
        ],
        "global_variables": store.global_variables,
    }


@router.post("/projects")
def create_project(data: dict):
    name = data.get("name", f"Project {len(store.projects) + 1}")
    pid = str(uuid.uuid4())
    env_id = str(uuid.uuid4())
    new_p = {
        "id": pid,
        "name": name,
        "environments": [{
            "id": env_id,
            "name": "Local",
            "base_url": data.get("base_url", ""),
            "variables": data.get("variables", {}),
        }],
        "current_environment_id": env_id,
        "tests": [],
    }
    store.projects.append(new_p)
    store.current_project_id = pid
    store.sync_current_config()
    store.save()
    return {"id": pid, "name": name}


@router.post("/projects/{project_id}/switch")
def switch_project(project_id: str):
    if not any(p.get("id") == project_id for p in store.projects):
        raise HTTPException(status_code=404, detail="Project not found")
    store.current_project_id = project_id
    store.sync_current_config()
    store.save()
    return {
        "status": "switched",
        "current_project_id": store.current_project_id,
        "config": store.current_config.to_dict(),
    }


@router.put("/projects/{project_id}")
def update_project(project_id: str, data: dict):
    proj = next((p for p in store.projects if p.get("id") == project_id), None)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    if "name" in data:
        proj["name"] = data["name"]
    if "environments" in data:
        proj["environments"] = data["environments"]
        if proj.get("current_environment_id") not in [e.get("id") for e in proj.get("environments", [])]:
            if proj.get("environments"):
                proj["current_environment_id"] = proj["environments"][0]["id"]
    # Sync FIRST so current_config reflects the new env data, THEN persist —
    # otherwise save_active_project() would clobber the just-updated env vars
    # with the stale current_config (this is what wiped saved tokens).
    store.sync_current_config()
    store.save()
    return {"status": "updated", "project": proj}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str):
    proj = next((p for p in store.projects if p.get("id") == project_id), None)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    store.projects.remove(proj)
    if store.current_project_id == project_id:
        store.current_project_id = store.projects[0]["id"] if store.projects else None
    store.sync_current_config()
    store.save()
    return {
        "status": "deleted",
        "current_project_id": store.current_project_id,
        "config": store.current_config.to_dict(),
    }


# ---- export / import (Postman-style) ---------------------------------

def _blank_template() -> dict:
    """A ready-to-edit project envelope so importing is fill-in-the-blanks."""
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "project": {
            "name": "My API Project",
            "environments": [
                {
                    "name": "Local",
                    "base_url": "https://api.example.com",
                    "variables": {"access_token": "", "refresh_token": ""},
                }
            ],
            "tests": [
                {
                    "name": "Example Login",
                    "url": "/auth/login",
                    "method": "POST",
                    "headers": {"Content-Type": "application/json"},
                    "payload": {"email": "{{random_email}}", "password": "ChangeMe123"},
                    "payload_type": "json",
                    "extractors": {"access_token": "body.access_token"},
                    "run_config": None,
                }
            ],
        },
    }


@router.get("/projects/template")
def project_template():
    """Blank importable template — same shape as an export."""
    return _blank_template()


@router.get("/projects/{project_id}/export")
def export_project(project_id: str, include_secrets: bool = False):
    """Export a project as a portable envelope.

    By default variable *values* are redacted (keys kept) because environments
    can hold live bearer tokens / JWTs. Pass ?include_secrets=true for a full
    round-trip export.
    """
    store.save_active_project()  # fold in-memory edits of the active project back first
    proj = next((p for p in store.projects if p.get("id") == project_id), None)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    envs = []
    for e in proj.get("environments", []):
        variables = e.get("variables", {}) or {}
        if not include_secrets:
            variables = {k: "" for k in variables}  # keep names, drop secret values
        envs.append({
            "name": e.get("name", ""),
            "base_url": e.get("base_url", ""),
            "variables": variables,
        })

    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "project": {
            "name": proj.get("name", "Exported Project"),
            "environments": envs,
            "tests": proj.get("tests", []),
        },
        "secrets_included": include_secrets,
    }


@router.post("/projects/import")
def import_project(data: dict):
    """Import a project from an export envelope or a bare project object.

    Fresh ids are minted for the project, every environment, and every endpoint
    so an import never collides with or overwrites existing data.
    """
    payload = data.get("project") if isinstance(data, dict) and "project" in data else data
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid import body: expected a project object")

    name = payload.get("name") or "Imported Project"

    # Validate endpoints through the engine's own contract; assign fresh ids.
    tests = []
    for idx, t in enumerate(payload.get("tests") or []):
        if not isinstance(t, dict):
            raise HTTPException(status_code=400, detail=f"Endpoint #{idx + 1} is not an object")
        try:
            et = EndpointTest.from_dict({**t, "id": str(uuid.uuid4())})
        except KeyError as e:
            raise HTTPException(status_code=400, detail=f"Endpoint #{idx + 1} missing required field {e}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Endpoint #{idx + 1} invalid: {e}")
        tests.append(et.to_dict())

    envs = []
    for e in payload.get("environments") or []:
        if not isinstance(e, dict):
            continue
        envs.append({
            "id": str(uuid.uuid4()),
            "name": e.get("name") or "Imported",
            "base_url": e.get("base_url", "") or "",
            "variables": e.get("variables", {}) or {},
        })
    if not envs:
        envs = [{"id": str(uuid.uuid4()), "name": "Local", "base_url": "", "variables": {}}]

    pid = str(uuid.uuid4())
    store.projects.append({
        "id": pid,
        "name": name,
        "environments": envs,
        "current_environment_id": envs[0]["id"],
        "tests": tests,
    })
    store.current_project_id = pid
    store.sync_current_config()
    store.save()
    return {
        "id": pid,
        "name": name,
        "imported": {"tests": len(tests), "environments": len(envs)},
        "config": store.current_config.to_dict(),
    }


@router.put("/global")
def update_global(data: dict):
    if "variables" in data:
        store.global_variables = data["variables"]
    store.sync_current_config()
    store.save()
    return {"status": "updated", "global_variables": store.global_variables}
