"""Readable, Git-friendly filesystem persistence for one Beacon project.

The linked folder is project source. ``tests.json`` keeps only the workspace
index/cache and the local link metadata. Git itself is intentionally outside
this service; any Git client can version the generated files.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

import yaml


FORMAT = "beacon.project"
SCHEMA_VERSION = 1
MANIFEST = "beacon.yaml"
LOCAL_DIR = ".beacon"
LOCAL_ENVIRONMENTS = ".beacon/environments.local.yaml"
SECRET_NAME = re.compile(
    r"token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key|credential",
    re.IGNORECASE,
)


class ProjectFileSyncError(ValueError):
    """A linked project cannot be read or written safely."""


class ProjectFileSyncConflict(ProjectFileSyncError):
    """Managed files changed after Beacon's last synchronized snapshot."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (value or "resource").lower()).strip("-")
    return (cleaned or "resource")[:48]


def _resource_file(directory: str, name: str, resource_id: str) -> str:
    suffix = re.sub(r"[^a-fA-F0-9]", "", resource_id or "")[:8] or hashlib.sha1(
        (resource_id or name).encode("utf-8")
    ).hexdigest()[:8]
    return f"{directory}/{_slug(name)}--{suffix}.yaml"


def _yaml_bytes(value: Any) -> bytes:
    return yaml.safe_dump(
        value,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=100,
    ).encode("utf-8")


def _safe_relative_path(root: Path, raw: str) -> Path:
    posix = PurePosixPath(str(raw))
    if posix.is_absolute() or ".." in posix.parts or not posix.parts:
        raise ProjectFileSyncError(f"Invalid project resource path: {raw}")
    target = root.joinpath(*posix.parts)
    try:
        resolved_root = root.resolve()
        resolved_target = target.resolve(strict=False)
        resolved_target.relative_to(resolved_root)
    except (OSError, ValueError) as error:
        raise ProjectFileSyncError(f"Project resource escapes the linked folder: {raw}") from error
    return target


class ProjectFileSyncService:
    """Serialize, compare, and reload linked project folders."""

    def link(self, project: dict, raw_path: str) -> dict:
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise ProjectFileSyncError("Choose a folder before linking the project")
        root = Path(raw_path).expanduser()
        if not root.is_absolute():
            raise ProjectFileSyncError("Linked project folder must use an absolute path")
        root.mkdir(parents=True, exist_ok=True)
        if not root.is_dir():
            raise ProjectFileSyncError("Linked project path is not a folder")
        if (root / MANIFEST).exists():
            raise ProjectFileSyncError(
                "This folder already contains beacon.yaml. Use Import > Folder to open the existing project."
            )
        reserved = []
        for directory in ("endpoints", "environments"):
            base = root / directory
            if base.is_dir() and any(path.is_file() for path in base.rglob("*.yaml")):
                reserved.append(directory)
        if reserved:
            joined = " and ".join(reserved)
            raise ProjectFileSyncError(
                f"This repository already uses Beacon's reserved {joined} YAML folder. "
                "Move those YAML files or initialize Beacon in a dedicated subfolder."
            )

        previous = project.get("file_sync")
        project["file_sync"] = {
            "path": str(root.resolve()),
            "schema_version": SCHEMA_VERSION,
            "last_synced_hash": None,
            "file_hashes": {},
            "last_synced_at": None,
            "last_error": None,
            "local_dirty": False,
        }
        try:
            self.write(project, force=True)
        except Exception:
            if previous is None:
                project.pop("file_sync", None)
            else:
                project["file_sync"] = previous
            raise
        return self.status(project)

    def unlink(self, project: dict) -> dict:
        project.pop("file_sync", None)
        return self.status(project)

    def open_existing(self, raw_path: str, existing_ids: set[str] | None = None) -> dict:
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise ProjectFileSyncError("Choose a Beacon project folder")
        root = Path(raw_path).expanduser()
        if not root.is_absolute() or not root.is_dir():
            raise ProjectFileSyncError("Existing project folder must be an absolute directory")
        root = root.resolve()
        manifest = self._load_yaml(root / MANIFEST)
        if manifest.get("format") != FORMAT:
            raise ProjectFileSyncError("The selected folder does not contain a Beacon project")
        if manifest.get("version") != SCHEMA_VERSION:
            raise ProjectFileSyncError(f"Unsupported Beacon project version: {manifest.get('version')}")
        source = manifest.get("project")
        if not isinstance(source, dict) or not source.get("id"):
            raise ProjectFileSyncError("beacon.yaml is missing a stable project ID")
        project_id = str(source["id"])
        if project_id in (existing_ids or set()):
            raise ProjectFileSyncError("This Beacon project is already open in the workspace")

        project = {
            "id": project_id,
            "name": str(source.get("name") or "Linked Project"),
            "environments": [],
            "items": [],
            "file_sync": {
                "path": str(root),
                "schema_version": SCHEMA_VERSION,
                "last_synced_hash": None,
                "file_hashes": {},
                "last_synced_at": None,
                "last_error": None,
                "local_dirty": False,
            },
        }
        self.reload(project)
        return project

    @staticmethod
    def missing_private_values(project: dict) -> list[dict[str, str]]:
        missing = []
        for environment in project.get("environments") or []:
            for key, value in (environment.get("variables") or {}).items():
                if SECRET_NAME.search(str(key)) and (value is None or str(value).strip() == ""):
                    missing.append({
                        "environment_id": str(environment.get("id") or ""),
                        "environment_name": str(environment.get("name") or "Environment"),
                        "key": str(key),
                    })
        return missing

    def sync_before_save(self, project: dict) -> None:
        metadata = project.get("file_sync")
        if not isinstance(metadata, dict) or not metadata.get("path"):
            return
        try:
            current = self.status(project)
            if current["state"] not in {"clean"}:
                serialized, _ = self._serialize(project)
                memory_snapshot = {
                    path: _sha256(content)
                    for path, content in serialized.items()
                    if not path.startswith(f"{LOCAL_DIR}/")
                }
                memory_changed = self._snapshot_hash(memory_snapshot) != metadata.get("last_synced_hash")
                metadata["local_dirty"] = bool(metadata.get("local_dirty")) or memory_changed
                metadata["last_error"] = current["message"]
                return
            self.write(project)
        except ProjectFileSyncError as error:
            metadata["local_dirty"] = True
            metadata["last_error"] = str(error)

    def status(self, project: dict) -> dict:
        metadata = project.get("file_sync")
        if not isinstance(metadata, dict) or not metadata.get("path"):
            return {
                "linked": False,
                "path": None,
                "state": "unlinked",
                "last_synced_at": None,
                "changes": [],
                "message": "Project files are stored only in this Beacon workspace",
            }

        root = Path(metadata["path"])
        base = {
            "linked": True,
            "path": str(root),
            "last_synced_at": metadata.get("last_synced_at"),
            "local_dirty": bool(metadata.get("local_dirty")),
            "last_error": metadata.get("last_error"),
        }
        if not root.is_dir() or not (root / MANIFEST).is_file():
            return {
                **base,
                "state": "missing_folder",
                "changes": [],
                "message": "The linked folder or beacon.yaml could not be found",
            }

        previous = metadata.get("file_hashes") or {}
        current = self._snapshot(root)
        changes = self._changes(previous, current)
        if changes:
            state = "conflict" if metadata.get("local_dirty") else "external_changes"
            message = (
                "Beacon and the linked folder both changed; choose which source to keep"
                if state == "conflict"
                else f"{len(changes)} project file{'s' if len(changes) != 1 else ''} changed outside Beacon"
            )
            return {**base, "state": state, "changes": changes, "message": message}
        return {**base, "state": "clean", "changes": [], "message": "Project files are up to date"}

    def write(self, project: dict, force: bool = False) -> None:
        metadata = project.get("file_sync") or {}
        root = Path(str(metadata.get("path") or ""))
        if not root.is_absolute():
            raise ProjectFileSyncError("Linked project folder is invalid")
        root.mkdir(parents=True, exist_ok=True)

        if not force and metadata.get("file_hashes"):
            changes = self._changes(metadata["file_hashes"], self._snapshot(root))
            if changes:
                raise ProjectFileSyncConflict("Linked project files changed outside Beacon")

        files, local_values = self._serialize(project)
        self._ensure_gitignore(root)
        files[LOCAL_ENVIRONMENTS] = _yaml_bytes({
            "version": SCHEMA_VERSION,
            "environments": local_values,
        })

        staging = Path(tempfile.mkdtemp(prefix=".beacon-write-", dir=str(root)))
        try:
            for relative, content in files.items():
                target = _safe_relative_path(staging, relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("wb") as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(handle.fileno())

            expected_public = {path for path in files if not path.startswith(f"{LOCAL_DIR}/")}
            old_public = set((metadata.get("file_hashes") or {}).keys())
            for relative in sorted(old_public - expected_public):
                target = _safe_relative_path(root, relative)
                if target.is_file():
                    target.unlink()

            for relative in sorted(files):
                source = _safe_relative_path(staging, relative)
                target = _safe_relative_path(root, relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, target)
        finally:
            shutil.rmtree(staging, ignore_errors=True)

        snapshot = self._snapshot(root)
        metadata.update({
            "schema_version": SCHEMA_VERSION,
            "last_synced_hash": self._snapshot_hash(snapshot),
            "file_hashes": snapshot,
            "last_synced_at": _utc_now(),
            "last_error": None,
            "local_dirty": False,
        })
        project["file_sync"] = metadata

    def reload(self, project: dict) -> dict:
        metadata = dict(project.get("file_sync") or {})
        root = Path(str(metadata.get("path") or ""))
        if not root.is_dir():
            raise ProjectFileSyncError("The linked project folder could not be found")

        manifest = self._load_yaml(root / MANIFEST)
        if manifest.get("format") != FORMAT:
            raise ProjectFileSyncError("beacon.yaml is not a Beacon project")
        if manifest.get("version") != SCHEMA_VERSION:
            raise ProjectFileSyncError(f"Unsupported Beacon project version: {manifest.get('version')}")
        source = manifest.get("project")
        if not isinstance(source, dict):
            raise ProjectFileSyncError("beacon.yaml is missing project metadata")
        if str(source.get("id")) != str(project.get("id")):
            raise ProjectFileSyncError("Linked folder belongs to a different Beacon project")

        environment_paths = source.get("environments") or []
        environments = []
        for relative in environment_paths:
            env = self._load_yaml(_safe_relative_path(root, str(relative)))
            if not isinstance(env.get("variables", {}), dict):
                raise ProjectFileSyncError(f"Environment variables must be a mapping: {relative}")
            environments.append(env)

        local = {}
        local_path = root / LOCAL_ENVIRONMENTS
        if local_path.is_file():
            local_doc = self._load_yaml(local_path)
            local = local_doc.get("environments") or {}
            if not isinstance(local, dict):
                raise ProjectFileSyncError("Local environment overlay is invalid")
        for env in environments:
            variables = dict(env.get("variables") or {})
            overlay = local.get(str(env.get("id"))) or {}
            if isinstance(overlay, dict):
                variables.update(overlay)
            env["variables"] = {key: value if value is not None else "" for key, value in variables.items()}

        referenced: set[str] = {MANIFEST, *[str(path) for path in environment_paths]}

        def load_items(nodes: Any) -> list:
            if not isinstance(nodes, list):
                raise ProjectFileSyncError("Project items must be a list")
            result = []
            for node in nodes:
                if not isinstance(node, dict):
                    raise ProjectFileSyncError("Project item must be a mapping")
                if node.get("type") == "folder":
                    result.append({
                        "type": "folder",
                        "id": str(node.get("id") or ""),
                        "name": str(node.get("name") or "Folder"),
                        "items": load_items(node.get("items") or []),
                    })
                    continue
                if node.get("type") != "request" or not node.get("file"):
                    raise ProjectFileSyncError("Request item is missing its endpoint file")
                relative = str(node["file"])
                endpoint = self._load_yaml(_safe_relative_path(root, relative))
                if str(endpoint.get("id")) != str(node.get("id")):
                    raise ProjectFileSyncError(f"Endpoint ID does not match its manifest entry: {relative}")
                referenced.add(relative)
                result.append({**endpoint, "type": "request"})
            return result

        items = load_items(source.get("items") or [])
        public_files = set(self._snapshot(root))
        unreferenced = sorted(public_files - referenced)
        if unreferenced:
            raise ProjectFileSyncError(f"Unreferenced managed project file: {unreferenced[0]}")

        replacement = {
            **project,
            "name": str(source.get("name") or project.get("name") or "Linked Project"),
            "environments": environments,
            "current_environment_id": source.get("current_environment_id"),
            "items": items,
            "file_sync": metadata,
        }
        replacement.pop("tests", None)
        project.clear()
        project.update(replacement)
        snapshot = self._snapshot(root)
        project["file_sync"].update({
            "last_synced_hash": self._snapshot_hash(snapshot),
            "file_hashes": snapshot,
            "last_synced_at": _utc_now(),
            "last_error": None,
            "local_dirty": False,
        })
        return self.status(project)

    def _serialize(self, project: dict) -> tuple[dict[str, bytes], dict[str, dict]]:
        files: dict[str, bytes] = {}
        local_values: dict[str, dict] = {}
        environment_paths = []
        for env in project.get("environments") or []:
            env_id = str(env.get("id") or "")
            if not env_id:
                raise ProjectFileSyncError("Every environment must have a stable ID")
            relative = _resource_file("environments", str(env.get("name") or "Environment"), env_id)
            environment_paths.append(relative)
            public_variables = {}
            private_variables = {}
            for key, value in (env.get("variables") or {}).items():
                if SECRET_NAME.search(str(key)):
                    public_variables[str(key)] = None
                    private_variables[str(key)] = value
                else:
                    public_variables[str(key)] = value
            files[relative] = _yaml_bytes({
                "id": env_id,
                "name": str(env.get("name") or "Environment"),
                "base_url": str(env.get("base_url") or ""),
                "variables": public_variables,
            })
            if private_variables:
                local_values[env_id] = private_variables

        def serialize_items(nodes: Any) -> list:
            result = []
            for node in nodes or []:
                if not isinstance(node, dict):
                    continue
                if node.get("type") == "folder":
                    result.append({
                        "type": "folder",
                        "id": str(node.get("id") or ""),
                        "name": str(node.get("name") or "Folder"),
                        "items": serialize_items(node.get("items") or []),
                    })
                    continue
                endpoint = {key: value for key, value in node.items() if key not in {"type", "file"}}
                endpoint_id = str(endpoint.get("id") or "")
                if not endpoint_id:
                    raise ProjectFileSyncError("Every endpoint must have a stable ID")
                relative = _resource_file("endpoints", str(endpoint.get("name") or "Request"), endpoint_id)
                files[relative] = _yaml_bytes(endpoint)
                result.append({
                    "type": "request",
                    "id": endpoint_id,
                    "file": relative,
                })
            return result

        source_items = project.get("items") or [
            {**test, "type": "request"} for test in project.get("tests", [])
        ]
        manifest = {
            "format": FORMAT,
            "version": SCHEMA_VERSION,
            "project": {
                "id": str(project.get("id") or ""),
                "name": str(project.get("name") or "Project"),
                "current_environment_id": project.get("current_environment_id"),
                "environments": environment_paths,
                "items": serialize_items(source_items),
            },
        }
        files[MANIFEST] = _yaml_bytes(manifest)
        return files, local_values

    @staticmethod
    def _load_yaml(path: Path) -> dict:
        try:
            value = yaml.safe_load(path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise ProjectFileSyncError(f"Project resource not found: {path.name}") from error
        except (OSError, yaml.YAMLError) as error:
            raise ProjectFileSyncError(f"Could not read {path.name}: {error}") from error
        if not isinstance(value, dict):
            raise ProjectFileSyncError(f"Project resource must contain a YAML mapping: {path.name}")
        return value

    @staticmethod
    def _ensure_gitignore(root: Path) -> None:
        path = root / ".gitignore"
        try:
            existing = path.read_text(encoding="utf-8") if path.exists() else ""
            lines = [line.strip() for line in existing.splitlines()]
            required = [entry for entry in (".beacon/", ".DS_Store", "Thumbs.db", "desktop.ini") if entry not in lines]
            if required:
                separator = "" if not existing or existing.endswith("\n") else "\n"
                with path.open("a", encoding="utf-8") as handle:
                    handle.write(separator + "\n".join(required) + "\n")
                    handle.flush()
                    os.fsync(handle.fileno())
        except OSError as error:
            raise ProjectFileSyncError("Could not protect local secrets with .gitignore") from error

    @staticmethod
    def _snapshot(root: Path) -> dict[str, str]:
        paths = []
        manifest = root / MANIFEST
        if manifest.is_file():
            paths.append(manifest)
        for directory in ("endpoints", "environments"):
            base = root / directory
            if base.is_dir():
                paths.extend(path for path in base.rglob("*.yaml") if path.is_file())
        result = {}
        for path in sorted(paths):
            relative = path.relative_to(root).as_posix()
            result[relative] = _sha256(path.read_bytes())
        return result

    @staticmethod
    def _changes(previous: dict[str, str], current: dict[str, str]) -> list[dict[str, str]]:
        changes = []
        for path in sorted(set(previous) | set(current)):
            if path not in previous:
                changes.append({"path": path, "kind": "added"})
            elif path not in current:
                changes.append({"path": path, "kind": "deleted"})
            elif previous[path] != current[path]:
                changes.append({"path": path, "kind": "modified"})
        return changes

    @staticmethod
    def _snapshot_hash(snapshot: dict[str, str]) -> str:
        body = "\n".join(f"{path}\0{digest}" for path, digest in sorted(snapshot.items()))
        return _sha256(body.encode("utf-8"))
