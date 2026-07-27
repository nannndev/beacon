from dataclasses import asdict
import os
import secrets
import uuid
from typing import Callable, Optional

import requests
import urllib3
import socket
import ssl
import json
from datetime import datetime, timezone

from .models import Mutation, Revision
from .sqlite_repository import SqliteSharedProjectRepository
from .lan_host import (
    LanHostService, DISCOVERY_PORT, local_client_info,
    MIN_SHARING_PROTOCOL_VERSION, SHARING_PROTOCOL_VERSION,
)
from .privacy import sanitize_project_source
from .tls import remote_fingerprint, format_fingerprint, pinned_session

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
requests.packages.urllib3.disable_warnings(requests.packages.urllib3.exceptions.InsecureRequestWarning)


_MISSING = object()


def _three_way_merge(base, team, mine, path=()):
    """Return (merged, conflicts) for JSON-like project source values."""
    if mine == team:
        return mine, []
    if mine == base:
        return team, []
    if team == base:
        return mine, []
    if all(isinstance(value, dict) for value in (base, team, mine)):
        merged, conflicts = {}, []
        for key in dict.fromkeys([*base.keys(), *team.keys(), *mine.keys()]):
            b, t, m = base.get(key, _MISSING), team.get(key, _MISSING), mine.get(key, _MISSING)
            value, nested = _three_way_merge(b, t, m, (*path, key))
            if value is not _MISSING:
                merged[key] = value
            conflicts.extend(nested)
        return merged, conflicts
    # Entity arrays are merged by stable ids so edits to different endpoints
    # do not conflict merely because they share the same collection array.
    if all(isinstance(value, list) for value in (base, team, mine)) and all(
        all(isinstance(item, dict) and item.get("id") for item in value)
        for value in (base, team, mine)
    ):
        maps = [{item["id"]: item for item in value} for value in (base, team, mine)]
        order = list(dict.fromkeys([*(item["id"] for item in team), *(item["id"] for item in mine)]))
        merged, conflicts = [], []
        for item_id in order:
            value, nested = _three_way_merge(
                maps[0].get(item_id, _MISSING), maps[1].get(item_id, _MISSING),
                maps[2].get(item_id, _MISSING), (*path, item_id),
            )
            if value is not _MISSING:
                merged.append(value)
            conflicts.extend(nested)
        return merged, conflicts
    conflict = {
        "path": list(path), "label": ".".join(str(part) for part in path),
        "base_value": None if base is _MISSING else base,
        "team_value": None if team is _MISSING else team,
        "local_value": None if mine is _MISSING else mine,
    }
    # Keep the local value in the draft; explicit field choices can replace it.
    return mine, [conflict]


def _set_path(source, path, value):
    current = source
    for part in path[:-1]:
        if isinstance(current, list):
            current = next(item for item in current if item.get("id") == part)
        else:
            current = current[part]
    final = path[-1]
    if isinstance(current, list):
        index = next(index for index, item in enumerate(current) if item.get("id") == final)
        current[index] = value
    elif value is None:
        current.pop(final, None)
    else:
        current[final] = value


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
        self._pending_fingerprints: dict[str, str] = {}
        self.lan_host = LanHostService(
            self.snapshot, self.revisions_after, self.mutate, device_id,
            repository.trust_device, repository.trusted_device, repository.touch_trusted_device,
            os.path.join(os.path.dirname(repository.path) or ".", "sharing-identity"),
        )

    def _local_actor(self) -> dict:
        return {
            "device_id": self.device_id(),
            "device_name": socket.gethostname(),
            "device_ip": self.lan_host.status().get("host_device_ip"),
        }

    @staticmethod
    def _mark_connected(origin: dict) -> None:
        origin.update({
            "connection_state": "connected", "sync_error": None,
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
            "offline_since": None, "retry_count": 0,
        })

    @staticmethod
    def _mark_offline(origin: dict, error: Exception) -> None:
        now = datetime.now(timezone.utc).isoformat()
        response = getattr(error, "response", None)
        state = (
            "identity_changed" if isinstance(error, requests.exceptions.SSLError)
            else "access_expired" if response is not None and response.status_code == 401
            else "host_offline"
        )
        origin.update({
            "connection_state": state, "sync_error": str(error),
            "offline_since": origin.get("offline_since") or now,
            "retry_count": int(origin.get("retry_count") or 0) + 1,
        })

    @staticmethod
    def _verified_base(origin: dict, suffix: str = "") -> str:
        expected = str(origin.get("certificate_fingerprint") or "").replace(":", "").lower()
        if not expected:
            raise requests.exceptions.SSLError("This shared project has no pinned host fingerprint; pair again")
        return f"https://{origin['host_address']}{suffix}"

    @staticmethod
    def _pinned(origin: dict):
        fingerprint = str(origin.get("certificate_fingerprint") or "").replace(":", "").lower()
        if not fingerprint:
            raise requests.exceptions.SSLError("This shared project has no pinned host fingerprint; pair again")
        return pinned_session(fingerprint)

    @staticmethod
    def _read_fingerprint(address: str) -> str:
        try:
            return remote_fingerprint(address)
        except ssl.SSLError as error:
            raise requests.exceptions.SSLError(str(error)) from error
        except OSError as error:
            raise requests.exceptions.ConnectionError(str(error)) from error

    def _reconnect_if_trusted(self, project: dict, error: Exception, adopt_snapshot: bool = True) -> bool:
        origin = project.get("shared_origin") or {}
        response = getattr(error, "response", None)
        credential = origin.get("trusted_credential")
        if response is None or response.status_code != 401 or not credential:
            return False
        base = self._verified_base(origin)
        session = self._pinned(origin)
        try:
            reconnect = session.post(f"{base}/beacon-share/reconnect", json={
                "project_id": project["id"], "device_id": self.device_id(),
                "trusted_credential": credential,
                **local_client_info(),
            }, timeout=4)
            reconnect.raise_for_status()
            data = reconnect.json()
            snapshot = data.get("snapshot") or {}
            source = snapshot.get("source")
            if adopt_snapshot and isinstance(source, dict):
                localized = self._localize_snapshot(source, existing=project)
                for key, value in localized.items():
                    if key != "shared_origin":
                        project[key] = value
            origin.update({
                "session_token": data["session_token"], "role": data.get("role", origin.get("role")),
                "revision": snapshot.get("revision", origin.get("revision")),
                "last_synced_source": sanitize_project_source(source) if isinstance(source, dict) else origin.get("last_synced_source"),
            })
            self._mark_connected(origin)
            return True
        except requests.RequestException:
            return False

    def discover_host(self, project: dict, timeout: float = 0.8) -> Optional[dict]:
        """Locate this shared project on the current LAN without exposing source."""
        origin = project.get("shared_origin") or {}
        if not origin.get("trusted_credential"):
            return None
        query = json.dumps({
            "type": "beacon-project-discovery", "project_id": project.get("id"),
            "device_id": self.device_id(),
        }).encode("utf-8")
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(timeout)
        try:
            # Loopback also makes same-device development deterministic; the
            # broadcast reaches teammates on the active LAN interface.
            for target in (("255.255.255.255", DISCOVERY_PORT), ("127.0.0.1", DISCOVERY_PORT)):
                try:
                    sock.sendto(query, target)
                except OSError:
                    continue
            deadline = __import__("time").monotonic() + timeout
            while __import__("time").monotonic() < deadline:
                payload, sender = sock.recvfrom(4096)
                answer = json.loads(payload.decode("utf-8"))
                if answer.get("type") == "beacon-project-host" and answer.get("project_id") == project.get("id"):
                    discovered_fingerprint = str(answer.get("certificate_fingerprint") or "").lower()
                    expected = str(origin.get("certificate_fingerprint") or "").replace(":", "").lower()
                    if not expected or not secrets.compare_digest(discovered_fingerprint, expected):
                        origin.update({
                            "connection_state": "identity_changed",
                            "sync_error": "A host answered for this project, but its certificate fingerprint changed",
                        })
                        return None
                    origin["host_address"] = f"{sender[0]}:{int(answer['port'])}"
                    origin["discovered_at"] = datetime.now(timezone.utc).isoformat()
                    origin["host_device_id"] = answer.get("host_device_id") or origin.get("host_device_id")
                    return answer
        except (socket.timeout, OSError, ValueError, json.JSONDecodeError):
            return None
        finally:
            sock.close()
        return None

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
                    "conflict": origin.get("conflict"),
                    "last_seen_at": origin.get("last_seen_at"),
                    "offline_since": origin.get("offline_since"),
                    "retry_count": origin.get("retry_count", 0),
                    "discovered_at": origin.get("discovered_at"),
                    "certificate_fingerprint": format_fingerprint(origin.get("certificate_fingerprint", "")),
                },
                "host": {"hosting": False},
            }
        host = self.lan_host.status()
        return {
            **status,
            "trusted_devices": self.repository.trusted_devices(project_id),
            "host": host if host.get("project_id") in {None, project_id} else {"hosting": False},
        }

    def refresh_pairing_code(self, project_id: str) -> dict:
        if self.lan_host.status().get("project_id") != project_id:
            raise KeyError("Project is not currently hosted")
        return self.lan_host.refresh_pairing_code()

    def request_join(self, address: str, code: str, device_name: str) -> dict:
        clean_address = address.strip().removeprefix("http://").removeprefix("https://").rstrip("/")
        fingerprint = self._read_fingerprint(clean_address)
        session = pinned_session(fingerprint)
        info_response = session.get(f"https://{clean_address}/beacon-share/info", timeout=4)
        info_response.raise_for_status()
        info = info_response.json()
        host_protocol = int(info.get("protocol") or 1)
        host_minimum = int(info.get("min_protocol") or host_protocol)
        if host_protocol < MIN_SHARING_PROTOCOL_VERSION or SHARING_PROTOCOL_VERSION < host_minimum:
            raise ValueError(
                f"Update required: host uses sharing protocol {host_protocol}, "
                f"this Beacon uses protocol {SHARING_PROTOCOL_VERSION}. "
                "Install compatible Beacon versions on both devices."
            )
        advertised = str(info.get("certificate_fingerprint") or "").replace(":", "").lower()
        if advertised and not secrets.compare_digest(fingerprint, advertised):
            raise ValueError("Host certificate fingerprint did not match its advertised identity")
        pair_response = session.post(
            f"https://{clean_address}/beacon-share/pair",
            json={
                "project_id": info["project_id"], "code": code,
                "device_id": self.device_id(), "device_name": device_name,
                **local_client_info(),
            }, timeout=6,
        )
        pair_response.raise_for_status()
        pairing = pair_response.json()
        self._pending_fingerprints[pairing["request_id"]] = fingerprint
        return {
            "address": clean_address,
            "request_id": pairing["request_id"],
            "status": pairing["status"],
            "project_name": pairing.get("project_name") or info.get("project_name"),
            "certificate_fingerprint": format_fingerprint(fingerprint),
        }

    def complete_join(self, address: str, request_id: str) -> dict:
        clean_address = address.strip().removeprefix("http://").removeprefix("https://").rstrip("/")
        fingerprint = self._read_fingerprint(clean_address)
        expected = self._pending_fingerprints.get(request_id)
        if not expected or not secrets.compare_digest(fingerprint, expected):
            raise ValueError("Host identity changed while pairing; start again")
        response = pinned_session(fingerprint).get(f"https://{clean_address}/beacon-share/pair/{request_id}", timeout=4)
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
            "trusted_credential": paired.get("trusted_credential"),
            "certificate_fingerprint": fingerprint,
            "connection_state": "connected",
            "last_synced_source": sanitize_project_source(source),
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
            "offline_since": None, "retry_count": 0,
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
        try:
            base = self._verified_base(origin, f"/beacon-share/projects/{project['id']}")
            session = self._pinned(origin)
        except requests.RequestException as error:
            self._mark_offline(origin, error)
            return False
        try:
            current = session.get(f"{base}/snapshot", headers=self._auth(origin), timeout=3)
            current.raise_for_status()
            remote = current.json()
            if remote.get("source") == source:
                self._mark_connected(origin)
                origin.update({"revision": remote.get("revision"), "last_synced_source": source})
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
            response = session.post(f"{base}/mutations", headers=self._auth(origin), json=payload, timeout=5)
            if response.status_code == 409:
                detail = response.json().get("detail", {})
                team_source = detail.get("latest_entity")
                base_source = origin.get("last_synced_source") or remote.get("source")
                merged_source, fields = _three_way_merge(base_source, team_source, source)
                if not fields:
                    merged_payload = {
                        "mutation_id": str(uuid.uuid4()),
                        "base_revision": detail.get("current_revision", 0),
                        "operation": "project.updated", "target_id": project["id"],
                        "payload": {key: value for key, value in merged_source.items() if key != "id"},
                        "summary": f"Auto-merged non-overlapping changes from {socket.gethostname()}",
                    }
                    merged_response = session.post(
                        f"{base}/mutations", headers=self._auth(origin), json=merged_payload, timeout=5,
                    )
                    merged_response.raise_for_status()
                    # Make the in-memory project match the canonical merge so
                    # the subsequent config save persists both teammates' edits.
                    localized = self._localize_snapshot(merged_source, existing=project)
                    for key, value in localized.items():
                        if key != "shared_origin":
                            project[key] = value
                    origin.update({
                        "revision": merged_response.json()["revision"],
                        "connection_state": "connected", "sync_error": None,
                        "conflict": None, "last_synced_source": merged_source,
                    })
                    return True
                origin.update({
                    "connection_state": "conflict",
                    "sync_error": "Team source changed before this edit could sync",
                    "conflict": {
                        "current_revision": detail.get("current_revision"),
                        "local_source": source,
                        "team_source": team_source,
                        "base_source": base_source,
                        "merged_source": merged_source,
                        "fields": fields,
                        "detected_at": datetime.now(timezone.utc).isoformat(),
                    },
                })
                return False
            response.raise_for_status()
            self._mark_connected(origin)
            origin.update({"revision": response.json()["revision"], "conflict": None, "last_synced_source": source})
            return True
        except requests.RequestException as error:
            if self._reconnect_if_trusted(project, error, adopt_snapshot=False):
                return self.push_if_joined(project)
            self._mark_offline(origin, error)
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
        self.lan_host.notify_revision()
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
        if origin.get("conflict"):
            return None
        try:
            base = self._verified_base(origin, f"/beacon-share/projects/{project['id']}")
            session = self._pinned(origin)
        except requests.RequestException as error:
            self._mark_offline(origin, error)
            return None
        try:
            revisions = session.get(
                f"{base}/revisions", params={"after": origin.get("revision", 0)},
                headers=self._auth(origin), timeout=3,
            )
            revisions.raise_for_status()
            if not revisions.json().get("items"):
                self._mark_connected(origin)
                return None
            response = session.get(f"{base}/snapshot", headers=self._auth(origin), timeout=3)
            response.raise_for_status()
            snapshot = response.json()
            updated = self._localize_snapshot(snapshot["source"], existing=project)
            updated["shared_origin"] = {
                **origin, "revision": snapshot["revision"],
                "connection_state": "connected", "sync_error": None,
                "last_synced_source": sanitize_project_source(snapshot["source"]),
            }
            self._mark_connected(updated["shared_origin"])
            return updated
        except requests.RequestException as error:
            if self._reconnect_if_trusted(project, error):
                return project
            self._mark_offline(origin, error)
            return None

    def watch_updates(
        self, project: dict, timeout: float = 5,
        active_target_id: Optional[str] = None, active_target_name: Optional[str] = None,
        activity: Optional[str] = None, allow_discovery: bool = True,
    ) -> Optional[dict]:
        """Wait for the host to announce a revision, then pull its snapshot."""
        origin = project.get("shared_origin")
        if not origin or origin.get("conflict"):
            return None
        try:
            base = self._verified_base(origin, f"/beacon-share/projects/{project['id']}")
            session = self._pinned(origin)
        except requests.RequestException as error:
            if allow_discovery and self.discover_host(project):
                return self.watch_updates(project, timeout, active_target_id, active_target_name, activity, False)
            self._mark_offline(origin, error)
            return None
        try:
            response = session.get(
                f"{base}/events", params={
                    "after": origin.get("revision", 0), "timeout": timeout,
                    "active_target_id": active_target_id, "active_target_name": active_target_name,
                    "activity": activity,
                },
                headers=self._auth(origin), timeout=timeout + 3,
            )
            response.raise_for_status()
            self._mark_connected(origin)
            if not response.json().get("items"):
                return None
            return self.pull_if_joined(project)
        except requests.RequestException as error:
            if self._reconnect_if_trusted(project, error):
                return project
            if allow_discovery and self.discover_host(project):
                return self.watch_updates(
                    project, timeout, active_target_id, active_target_name, activity,
                    allow_discovery=False,
                )
            self._mark_offline(origin, error)
            return None

    def resolve_conflict(self, project: dict, resolution: str, choices: Optional[dict] = None) -> dict:
        origin = project.get("shared_origin") or {}
        conflict = origin.get("conflict")
        if not conflict:
            raise ValueError("This project has no unresolved sharing conflict")
        team_source = conflict.get("team_source")
        local_source = conflict.get("local_source")
        revision = int(conflict.get("current_revision") or 0)
        if resolution == "team":
            if not isinstance(team_source, dict):
                raise ValueError("Team source is unavailable; sync again")
            updated = self._localize_snapshot(team_source, existing=project)
            updated["shared_origin"] = {
                **origin, "revision": revision, "connection_state": "connected",
                "sync_error": None, "conflict": None, "last_synced_source": team_source,
            }
            return updated
        if resolution not in {"mine", "merge"}:
            raise ValueError("Resolution must be team, mine, or merge")
        if origin.get("role") != "editor" or not isinstance(local_source, dict):
            raise ValueError("Local source cannot be applied with this role")
        resolved_source = local_source
        if resolution == "merge":
            resolved_source = conflict.get("merged_source")
            if not isinstance(resolved_source, dict):
                raise ValueError("Merged source is unavailable")
            resolved_source = __import__("copy").deepcopy(resolved_source)
            fields = conflict.get("fields") or []
            choices = choices or {}
            missing = [field["label"] for field in fields if choices.get(field["label"]) not in {"team", "mine"}]
            if missing:
                raise ValueError("Choose team or mine for every conflicting field")
            for field in fields:
                selected = field["team_value"] if choices[field["label"]] == "team" else field["local_value"]
                _set_path(resolved_source, field["path"], selected)
        base = self._verified_base(origin, f"/beacon-share/projects/{project['id']}")
        session = self._pinned(origin)
        response = session.post(f"{base}/mutations", headers=self._auth(origin), json={
            "mutation_id": str(uuid.uuid4()), "base_revision": revision,
            "operation": "project.updated", "target_id": project["id"],
            "payload": {key: value for key, value in resolved_source.items() if key != "id"},
            "summary": f"Resolved conflict from {socket.gethostname()} ({resolution})",
        }, timeout=5)
        response.raise_for_status()
        updated = self._localize_snapshot(resolved_source, existing=project)
        updated["shared_origin"] = {
            **origin, "revision": response.json()["revision"], "connection_state": "connected",
            "sync_error": None, "conflict": None, "last_synced_source": resolved_source,
        }
        return updated

    def decide_pairing(self, project_id: str, request_id: str, approved: bool, role: str) -> dict:
        if self.lan_host.status().get("project_id") != project_id:
            raise KeyError("Project is not currently hosted")
        return self.lan_host.decide_pairing(request_id, approved, role)

    def update_member(self, project_id: str, device_id: str, role: str) -> dict:
        if self.lan_host.status().get("project_id") != project_id:
            raise KeyError("Project is not currently hosted")
        trusted = self.repository.update_trusted_device_role(project_id, device_id, role)
        try:
            return self.lan_host.update_member(device_id, role)
        except KeyError:
            if trusted:
                return {"device_id": device_id, "role": role, "connected": False}
            raise

    def remove_member(self, project_id: str, device_id: str) -> dict:
        if self.lan_host.status().get("project_id") != project_id:
            raise KeyError("Project is not currently hosted")
        trusted = self.repository.revoke_trusted_device(project_id, device_id)
        try:
            return self.lan_host.remove_member(device_id)
        except KeyError:
            if trusted:
                return {"device_id": device_id, "removed": True, "connected": False}
            raise

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
