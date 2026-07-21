import uuid
import json

from fastapi import APIRouter, HTTPException

from ..state import store
from ..core.tester import EndpointTest
from ..catalogs import JSONPLACEHOLDER_TEMPLATE_ID, build_jsonplaceholder_project
from ..services.notify_discord import send_test_message

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
                "template_id": p.get("template_id"),
                "environments": p.get("environments", []),
                "current_environment_id": p.get("current_environment_id"),
                "notifications": p.get("notifications", {}),
                "items": p.get("items") or [
                    {"type": "request", **t} for t in p.get("tests", [])
                ],
            }
            for p in store.projects
        ],
        "global_variables": store.global_variables,
    }


def ensure_jsonplaceholder_project(target_store, name="JSONPlaceholder API"):
    """Create or select the built-in sample without matching display names."""
    existing = next(
        (
            project
            for project in target_store.projects
            if project.get("template_id") == JSONPLACEHOLDER_TEMPLATE_ID
        ),
        None,
    )
    if existing:
        target_store.current_project_id = existing["id"]
        target_store.sync_current_config()
        target_store.save()
        return existing, False

    project = build_jsonplaceholder_project(name=name)
    target_store.projects.append(project)
    target_store.current_project_id = project["id"]
    target_store.sync_current_config()
    target_store.save()
    return project, True


@router.post("/projects/samples/jsonplaceholder")
def add_jsonplaceholder_sample():
    project, created = ensure_jsonplaceholder_project(store)
    return {"project_id": project["id"], "created": created}


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
    if "items" in data:
        proj["items"] = data["items"]  # allow updating the full tree (for folder mgmt)
    if "notifications" in data and isinstance(data["notifications"], dict):
        n = data["notifications"]
        proj["notifications"] = {
            "discord_webhook": str(n.get("discord_webhook", "") or "").strip(),
            "mode": n.get("mode") if n.get("mode") in ("off", "on_failure", "always") else "off",
        }
    # Sync FIRST so current_config reflects the new env data, THEN persist —
    # otherwise save_active_project() would clobber the just-updated env vars
    # with the stale current_config (this is what wiped saved tokens).
    store.sync_current_config()
    store.save()
    return {"status": "updated", "project": proj}


@router.post("/projects/{project_id}/notifications/test")
def test_notification(project_id: str, data: dict):
    """Send a one-off 'Beacon connected' message to a Discord webhook so the
    user can confirm the URL works before saving. Always returns 200 with an
    {ok, error} body — the UI shows the message rather than treating it as a
    request failure. Tests the URL from the body so it works before saving."""
    if not any(p.get("id") == project_id for p in store.projects):
        raise HTTPException(status_code=404, detail="Project not found")
    webhook = (data or {}).get("webhook_url", "")
    ok, error = send_test_message(webhook)
    return {"ok": ok, "error": error}


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
    """A ready-to-edit project envelope so importing is fill-in-the-blanks.
    Uses Postman-like 'items' tree (folders + requests) for flexibility.
    """
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
            "items": [
                {
                    "id": "folder-auth",
                    "name": "Auth",
                    "type": "folder",
                    "items": [
                        {
                            "id": "req-login",
                            "name": "Example Login",
                            "type": "request",
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
                {
                    "id": "req-profile",
                    "name": "Get Profile",
                    "type": "request",
                    "url": "/me",
                    "method": "GET",
                    "headers": {"Authorization": "Bearer {{access_token}}"},
                    "payload": {},
                    "payload_type": "json",
                    "extractors": {},
                    "run_config": None,
                },
            ],
        },
    }


def _convert_postman_to_our_items(postman_data: dict) -> list:
    """Convert Postman collection v2.1 structure to our recursive items tree."""
    def convert(node: dict) -> dict:
        if "item" in node:  # folder
            return {
                "id": str(uuid.uuid4()),
                "name": node.get("name", "Folder"),
                "type": "folder",
                "items": [convert(child) for child in node.get("item", [])],
            }
        else:  # request
            req = node.get("request", {})
            url = req.get("url", "")
            if isinstance(url, dict):
                url = url.get("raw", "") or ""
            method = req.get("method", "GET") or "GET"

            headers = {}
            for h in req.get("header", []) or []:
                if isinstance(h, dict) and h.get("key"):
                    headers[h["key"]] = h.get("value", "")

            body = {}
            payload_type = "json"
            b = req.get("body", {}) or {}
            mode = b.get("mode")
            if mode == "raw":
                raw = b.get("raw", "")
                try:
                    body = json.loads(raw) if raw.strip() else {}
                except Exception:
                    body = {"raw": raw}
                payload_type = "json"
            elif mode == "formdata":
                payload_type = "form"
                for f in b.get("formdata", []) or []:
                    if isinstance(f, dict) and f.get("key"):
                        body[f["key"]] = f.get("value", "")
            elif mode == "urlencoded":
                payload_type = "form"
                for f in b.get("urlencoded", []) or []:
                    if isinstance(f, dict) and f.get("key"):
                        body[f["key"]] = f.get("value", "")

            return {
                "id": str(uuid.uuid4()),
                "name": node.get("name", "Request"),
                "type": "request",
                "url": url,
                "method": method,
                "headers": headers,
                "payload": body,
                "payload_type": payload_type,
                "extractors": {},
                "run_config": None,
            }

    return [convert(it) for it in postman_data.get("item", []) if isinstance(it, dict)]


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
            "items": proj.get("items") or [
                {**t, "type": "request"} for t in proj.get("tests", [])
            ],
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

    # Detect Postman collection
    if "info" in payload and "item" in payload:
        name = payload.get("info", {}).get("name") or payload.get("name") or "Imported Postman Collection"
        items = _convert_postman_to_our_items(payload)
        # Create default env from Postman variables if any
        env_vars = {}
        for v in payload.get("variable", []) or []:
            if isinstance(v, dict) and v.get("key"):
                env_vars[v["key"]] = v.get("value", "")
        payload = {
            "name": name,
            "environments": [{"name": "Imported", "base_url": "", "variables": env_vars}],
            "items": items,
        }

    is_legacy_config = (
        "tests" in payload
        and ("base_url" in payload or "variables" in payload)
        and "environments" not in payload
    )
    name = payload.get("name") or ("Imported Config" if is_legacy_config else "Imported Project")

    # Support Postman-style nested items + legacy flat tests
    raw_items = payload.get("items")
    raw_tests = payload.get("tests") or []

    def _assign_fresh_ids(node: dict) -> dict:
        node = dict(node)  # copy
        node["id"] = str(uuid.uuid4())
        if node.get("type") == "folder" and node.get("items"):
            node["items"] = [_assign_fresh_ids(child) for child in node["items"]]
        return node

    items: list = []
    if raw_items:
        items = [_assign_fresh_ids(item) for item in raw_items]
    elif raw_tests:
        # legacy flat -> top level requests
        items = [
            {"type": "request", **t, "id": str(uuid.uuid4())} for t in raw_tests
        ]

    # Flatten for validation against the engine (we still keep flat tests for execution)
    flat_tests = []
    def _collect_requests(nodes):
        for n in nodes or []:
            if n.get("type") == "request":
                flat_tests.append(n)
            elif n.get("type") == "folder":
                _collect_requests(n.get("items", []))
    _collect_requests(items)

    # Validate endpoints
    validated_flat = []
    for idx, t in enumerate(flat_tests):
        if not isinstance(t, dict):
            raise HTTPException(status_code=400, detail=f"Endpoint #{idx + 1} is not an object")
        try:
            et = EndpointTest.from_dict({**t, "id": t.get("id") or str(uuid.uuid4())})
        except KeyError as e:
            raise HTTPException(status_code=400, detail=f"Endpoint #{idx + 1} missing required field {e}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Endpoint #{idx + 1} invalid: {e}")
        validated_flat.append(et.to_dict())

    envs = []
    if is_legacy_config:
        envs.append({
            "id": str(uuid.uuid4()),
            "name": "Imported",
            "base_url": payload.get("base_url", "") or "",
            "variables": payload.get("variables", {}) or {},
        })
    else:
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
        "items": items,
        # also keep flat for backward
        "tests": validated_flat,
    })
    store.current_project_id = pid
    store.sync_current_config()
    store.save()
    return {
        "id": pid,
        "name": name,
        "imported": {"tests": len(validated_flat), "environments": len(envs)},
        "config": store.current_config.to_dict(),
    }


@router.put("/global")
def update_global(data: dict):
    if "variables" in data:
        store.global_variables = data["variables"]
    store.sync_current_config()
    store.save()
    return {"status": "updated", "global_variables": store.global_variables}
