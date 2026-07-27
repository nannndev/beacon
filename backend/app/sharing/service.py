from dataclasses import asdict
import os
import uuid
from typing import Callable, Optional

import requests
import socket

from .models import Mutation, Revision
from .sqlite_repository import SqliteSharedProjectRepository
from .lan_host import LanHostService
from .privacy import sanitize_project_source


class SharedProjectService:
    """Local application boundary for revisioned shared-project source."""

    def __init__(
        self,
        repository: SqliteSharedProjectRepository,
        project_lookup: Callable[[str], Optional[dict]],
        device_id: Callable[[], str],
    ):
        self.repository = repository
        self.project_lookup = project_lookup
        self.device_id = device_id
        self.lan_host = LanHostService(self.snapshot, self.revisions_after, self.mutate, device_id)

    def _local_actor(self) -> dict:
        return {
            "device_id": self.device_id(),
            "device_name": socket.gethostname(),
            "device_ip": self.lan_host.status().get("host_device_ip"),
        }

    @staticmethod
    def _change_summary(before: dict, after: dict) -> str:
        """Describe a full-source mutation without leaking source values."""
        changes = []
        if before.get("name") != after.get("name"):
            changes.append(f"Renamed project to {after.get('name', 'Untitled')}")

        def indexed(source: dict, key: str) -> dict:
            if key == "items":
                result = {}
                def walk(items):
                    for item in items or []:
                        if isinstance(item, dict) and item.get("id"):
                            result[item["id"]] = item
                            walk(item.get("items", []))
                walk(source.get("items", []))
                return result
            return {item.get("id"): item for item in source.get(key, []) if item.get("id")}

        for key, label in (("items", "source item"), ("environments", "environment")):
            old, new = indexed(before, key), indexed(after, key)
            added, removed = set(new) - set(old), set(old) - set(new)
            changed = {item_id for item_id in set(old) & set(new) if old[item_id] != new[item_id]}
            if added:
                changes.append(f"Added {len(added)} {label}{'' if len(added) == 1 else 's'}")
            if removed:
                changes.append(f"Removed {len(removed)} {label}{'' if len(removed) == 1 else 's'}")
            if changed:
                names = [str(new[item_id].get("name", label)) for item_id in list(changed)[:2]]
                changes.append(f"Updated {', '.join(names)}" + (f" +{len(changed)-2}" if len(changed) > 2 else ""))
        return " · ".join(changes) or "Updated project source"

    def initialize(self) -> None:
        self.repository.initialize()
        # Host sessions are intentionally ephemeral and never survive an app
        # restart. The owner must explicitly expose the project again.
        self.repository.disable_all_sharing()

    def enable(self, project_id: str) -> dict:
        project = self.project_lookup(project_id)
        if not project:
            raise KeyError(f"Project {project_id!r} not found")
        self.repository.import_project(project, self.device_id())
        status = self.repository.set_sharing_enabled(project_id, True)
        if os.getenv("BEACON_ALLOW_INSECURE_LAN") == "1":
            self.lan_host.start(project_id, project.get("name", "Shared project"))
        return {**status, "host": self.lan_host.status()}

    def disable(self, project_id: str) -> dict:
        if self.lan_host.status().get("project_id") == project_id:
            self.lan_host.stop()
        return {**self.repository.set_sharing_enabled(project_id, False), "host": self.lan_host.status()}

    def status(self, project_id: str) -> Optional[dict]:
        status = self.repository.status(project_id)
        if not status:
            project = self.project_lookup(project_id)
            origin = project.get("shared_origin") if project else None
            if not origin:
                return None
            return {
                "project_id": project_id,
                "sharing_enabled": True,
                "revision": origin.get("revision"),
                "member": {
                    "role": origin.get("role"),
                    "host_address": origin.get("host_address"),
                    "connection_state": origin.get("connection_state", "connected"),
                    "sync_error": origin.get("sync_error"),
                },
                "host": {"hosting": False},
            }
        host = self.lan_host.status()
        return {**status, "host": host if host.get("project_id") in {None, project_id} else {"hosting": False}}

    def refresh_pairing_code(self, project_id: str) -> dict:
        if self.lan_host.status().get("project_id") != project_id:
            raise KeyError("Project is not currently hosted")
        return self.lan_host.refresh_pairing_code()

    def request_join(self, address: str, code: str, device_name: str) -> dict:
        clean_address = address.strip().removeprefix("http://").removeprefix("https://").rstrip("/")
        info_response = requests.get(f"http://{clean_address}/beacon-share/info", timeout=4)
        info_response.raise_for_status()
        info = info_response.json()
        pair_response = requests.post(
            f"http://{clean_address}/beacon-share/pair",
            json={
                "project_id": info["project_id"], "code": code,
                "device_id": self.device_id(), "device_name": device_name,
            }, timeout=6,
        )
        pair_response.raise_for_status()
        pairing = pair_response.json()
        return {
            "address": clean_address,
            "request_id": pairing["request_id"],
            "status": pairing["status"],
            "project_name": pairing.get("project_name") or info.get("project_name"),
        }

    def complete_join(self, address: str, request_id: str) -> dict:
        clean_address = address.strip().removeprefix("http://").removeprefix("https://").rstrip("/")
        response = requests.get(f"http://{clean_address}/beacon-share/pair/{request_id}", timeout=4)
        response.raise_for_status()
        paired = response.json()
        if paired.get("status") != "approved":
            return {"status": paired.get("status", "pending")}
        snapshot = paired.get("snapshot") or {}
        source = snapshot.get("source")
        if not isinstance(source, dict):
            raise ValueError("Host returned an invalid project snapshot")
        joined = self._localize_snapshot(source)
        joined["shared_origin"] = {
            "host_address": clean_address,
            "host_device_id": paired.get("host_device_id"),
            "role": paired.get("role", "viewer"),
            "revision": snapshot.get("revision"),
            "session_token": paired.get("session_token"),
            "connection_state": "connected",
        }
        return {"status": "approved", "project": joined}

    @staticmethod
    def _auth(origin: dict) -> dict:
        return {"Authorization": f"Bearer {origin.get('session_token', '')}"}

    def push_if_joined(self, project: dict) -> bool:
        origin = project.get("shared_origin")
        if not origin:
            return False
        source = sanitize_project_source(project)
        base = f"http://{origin['host_address']}/beacon-share/projects/{project['id']}"
        try:
            current = requests.get(f"{base}/snapshot", headers=self._auth(origin), timeout=3)
            current.raise_for_status()
            remote = current.json()
            if remote.get("source") == source:
                origin.update({"revision": remote.get("revision"), "connection_state": "connected", "sync_error": None})
                return False
            if origin.get("role") != "editor":
                origin.update({"connection_state": "read_only", "sync_error": "Viewer role cannot edit shared source"})
                return False
            payload = {
                "mutation_id": str(uuid.uuid4()),
                "base_revision": origin.get("revision", 0),
                "operation": "project.updated",
                "target_id": project["id"],
                "payload": {key: value for key, value in source.items() if key != "id"},
                "summary": f"Updated {project.get('name', 'project')}",
            }
            response = requests.post(f"{base}/mutations", headers=self._auth(origin), json=payload, timeout=5)
            response.raise_for_status()
            origin.update({"revision": response.json()["revision"], "connection_state": "connected", "sync_error": None})
            return True
        except requests.RequestException as error:
            origin.update({"connection_state": "host_offline", "sync_error": str(error)})
            return False

    def record_local_change(self, project: dict) -> bool:
        if project.get("shared_origin"):
            return self.push_if_joined(project)
        if self.lan_host.status().get("project_id") != project.get("id"):
            return False
        status = self.repository.status(project.get("id", ""))
        if not status or not status["sharing_enabled"]:
            return False
        source = sanitize_project_source(project)
        snapshot = self.repository.snapshot(project["id"])
        if snapshot and snapshot["source"] == source:
            return False
        mutation = Mutation(
            mutation_id=str(uuid.uuid4()), project_id=project["id"],
            base_revision=status["revision"], operation="project.updated",
            target_id=project["id"], payload={key: value for key, value in source.items() if key != "id"},
        )
        actor = self._local_actor()
        self.repository.apply_mutation(
            mutation, actor["device_id"], self._change_summary(snapshot["source"], source),
            actor["device_name"], actor["device_ip"],
        )
        return True

    def pull_updates(self, project: dict) -> Optional[dict]:
        if project.get("shared_origin"):
            return self.pull_if_joined(project)
        if self.lan_host.status().get("project_id") != project.get("id"):
            return None
        status = self.repository.status(project.get("id", ""))
        if not status or not status["sharing_enabled"]:
            return None
        snapshot = self.repository.snapshot(project["id"])
        if not snapshot or snapshot["source"] == sanitize_project_source(project):
            return None
        updated = self._localize_snapshot(snapshot["source"], existing=project)
        if project.get("notifications"):
            updated["notifications"] = project["notifications"]
        return updated

    def pull_if_joined(self, project: dict) -> Optional[dict]:
        origin = project.get("shared_origin")
        if not origin:
            return None
        base = f"http://{origin['host_address']}/beacon-share/projects/{project['id']}"
        try:
            revisions = requests.get(
                f"{base}/revisions", params={"after": origin.get("revision", 0)},
                headers=self._auth(origin), timeout=3,
            )
            revisions.raise_for_status()
            if not revisions.json().get("items"):
                origin.update({"connection_state": "connected", "sync_error": None})
                return None
            response = requests.get(f"{base}/snapshot", headers=self._auth(origin), timeout=3)
            response.raise_for_status()
            snapshot = response.json()
            updated = self._localize_snapshot(snapshot["source"], existing=project)
            updated["shared_origin"] = {
                **origin, "revision": snapshot["revision"],
                "connection_state": "connected", "sync_error": None,
            }
            return updated
        except requests.RequestException as error:
            origin.update({"connection_state": "host_offline", "sync_error": str(error)})
            return None

    def decide_pairing(self, project_id: str, request_id: str, approved: bool, role: str) -> dict:
        if self.lan_host.status().get("project_id") != project_id:
            raise KeyError("Project is not currently hosted")
        return self.lan_host.decide_pairing(request_id, approved, role)

    def update_member(self, project_id: str, device_id: str, role: str) -> dict:
        if self.lan_host.status().get("project_id") != project_id:
            raise KeyError("Project is not currently hosted")
        return self.lan_host.update_member(device_id, role)

    def remove_member(self, project_id: str, device_id: str) -> dict:
        if self.lan_host.status().get("project_id") != project_id:
            raise KeyError("Project is not currently hosted")
        return self.lan_host.remove_member(device_id)

    @staticmethod
    def _localize_snapshot(source: dict, existing: Optional[dict] = None) -> dict:
        project = {**source}
        existing_envs = {env.get("id"): env for env in (existing or {}).get("environments", [])}
        for environment in project.get("environments", []):
            localized = {}
            existing_variables = existing_envs.get(environment.get("id"), {}).get("variables", {})
            for key, entry in (environment.get("variables") or {}).items():
                if isinstance(entry, dict):
                    localized[key] = entry.get("value") if entry.get("scope") == "shared" else existing_variables.get(key, "")
                else:
                    localized[key] = entry
            environment["variables"] = localized
        project["id"] = str(project.get("id") or uuid.uuid4())
        return project

    def snapshot(self, project_id: str) -> Optional[dict]:
        return self.repository.snapshot(project_id)

    def revisions_after(self, project_id: str, revision: int) -> list[dict]:
        return [asdict(item) for item in self.repository.revisions_after(project_id, revision)]

    def mutate(self, data: dict, actor_device_id=None) -> Revision:
        mutation = Mutation(
            mutation_id=str(data.get("mutation_id", "")),
            project_id=str(data.get("project_id", "")),
            base_revision=int(data.get("base_revision", -1)),
            operation=str(data.get("operation", "")),
            target_id=data.get("target_id"),
            payload=data.get("payload") if isinstance(data.get("payload"), dict) else {},
        )
        if not mutation.mutation_id:
            raise ValueError("mutation_id is required")
        if not mutation.project_id:
            raise ValueError("project_id is required")
        if mutation.operation not in {"project.updated", "endpoint.updated", "folder.updated", "environment.updated"}:
            raise ValueError("Unsupported mutation operation")
        status = self.repository.status(mutation.project_id)
        if not status or not status["sharing_enabled"]:
            raise ValueError("Project sharing is not enabled")
        actor = actor_device_id if isinstance(actor_device_id, dict) else {
            **self._local_actor(), "device_id": actor_device_id or self.device_id(),
        }
        snapshot = self.repository.snapshot(mutation.project_id)
        summary = str(data.get("summary") or mutation.operation)
        if mutation.operation == "project.updated" and snapshot:
            candidate = {**snapshot["source"], **mutation.payload}
            summary = self._change_summary(snapshot["source"], candidate)
        return self.repository.apply_mutation(
            mutation, actor["device_id"], summary,
            actor.get("device_name"), actor.get("device_ip"),
        )
