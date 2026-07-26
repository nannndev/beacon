import copy
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Optional

from .models import Mutation, MutationConflict, Revision
from .privacy import sanitize_project_source


SCHEMA_VERSION = 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _target_type(operation: str) -> str:
    return operation.split(".", 1)[0]


def _walk_items(items: list):
    for item in items or []:
        yield item
        if item.get("type") == "folder":
            yield from _walk_items(item.get("items", []))


def _find_entity(source: dict, target_type: str, target_id: Optional[str]):
    if target_type == "project":
        return source
    if target_type in {"folder", "endpoint"}:
        expected = "request" if target_type == "endpoint" else "folder"
        return next(
            (item for item in _walk_items(source.get("items", []))
             if item.get("id") == target_id and item.get("type") == expected),
            None,
        )
    if target_type == "environment":
        return next((env for env in source.get("environments", []) if env.get("id") == target_id), None)
    return None


def _update_entity(source: dict, mutation: Mutation) -> None:
    target_type, action = mutation.operation.split(".", 1)
    if action != "updated":
        raise ValueError(f"Unsupported Phase 1 operation: {mutation.operation}")
    entity = _find_entity(source, target_type, mutation.target_id)
    if entity is None:
        raise KeyError(f"{target_type} {mutation.target_id!r} not found")
    forbidden = {"id", "type"}
    entity.update({k: copy.deepcopy(v) for k, v in mutation.payload.items() if k not in forbidden})


class SqliteSharedProjectRepository:
    """Transactional canonical source for projects that opt into sharing."""

    def __init__(self, path: str):
        self.path = path

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def initialize(self) -> None:
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS shared_projects (
                    project_id TEXT PRIMARY KEY,
                    owner_device_id TEXT NOT NULL,
                    current_revision INTEGER NOT NULL,
                    source_schema_version INTEGER NOT NULL,
                    sharing_enabled INTEGER NOT NULL,
                    source_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS project_revisions (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES shared_projects(project_id) ON DELETE CASCADE,
                    revision INTEGER NOT NULL,
                    base_revision INTEGER NOT NULL,
                    mutation_id TEXT NOT NULL,
                    actor_device_id TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    target_id TEXT,
                    summary TEXT NOT NULL,
                    patch_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(project_id, revision),
                    UNIQUE(project_id, mutation_id)
                );
            """)

    def pragma(self, name: str):
        with self._connect() as db:
            return db.execute(f"PRAGMA {name}").fetchone()[0]

    def import_project(self, project: dict, owner_device_id: str) -> dict:
        project_id = str(project.get("id") or uuid.uuid4())
        source = sanitize_project_source({**project, "id": project_id})
        now = _now()
        mutation_id = f"import:{project_id}"
        with self._connect() as db:
            existing = db.execute(
                "SELECT current_revision, source_json FROM shared_projects WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if existing:
                return {"project_id": project_id, "revision": existing["current_revision"], "source": json.loads(existing["source_json"])}
            db.execute(
                "INSERT INTO shared_projects VALUES (?, ?, 1, ?, 0, ?, ?, ?)",
                (project_id, owner_device_id, SCHEMA_VERSION, json.dumps(source), now, now),
            )
            self._insert_revision(db, Revision(
                id=str(uuid.uuid4()), project_id=project_id, revision=1, base_revision=0,
                mutation_id=mutation_id, actor_device_id=owner_device_id,
                operation="project.imported", target_type="project", target_id=project_id,
                summary=f"Imported {source.get('name', 'project')} for sharing",
                patch={"source": source}, created_at=now,
            ))
        return {"project_id": project_id, "revision": 1, "source": source}

    def snapshot(self, project_id: str) -> Optional[dict]:
        with self._connect() as db:
            row = db.execute(
                "SELECT current_revision, source_schema_version, source_json FROM shared_projects WHERE project_id = ?",
                (project_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "project_id": project_id,
            "revision": row["current_revision"],
            "source_schema_version": row["source_schema_version"],
            "source": json.loads(row["source_json"]),
        }

    def status(self, project_id: str) -> Optional[dict]:
        with self._connect() as db:
            row = db.execute(
                """SELECT project_id, owner_device_id, current_revision,
                          source_schema_version, sharing_enabled, created_at, updated_at
                   FROM shared_projects WHERE project_id = ?""",
                (project_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "project_id": row["project_id"],
            "owner_device_id": row["owner_device_id"],
            "revision": row["current_revision"],
            "source_schema_version": row["source_schema_version"],
            "sharing_enabled": bool(row["sharing_enabled"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def set_sharing_enabled(self, project_id: str, enabled: bool) -> dict:
        now = _now()
        with self._connect() as db:
            cursor = db.execute(
                "UPDATE shared_projects SET sharing_enabled = ?, updated_at = ? WHERE project_id = ?",
                (int(enabled), now, project_id),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"Project {project_id!r} not found")
        return self.status(project_id)

    def disable_all_sharing(self) -> None:
        with self._connect() as db:
            db.execute("UPDATE shared_projects SET sharing_enabled = 0 WHERE sharing_enabled = 1")

    def apply_mutation(self, mutation: Mutation, actor_device_id: str, summary: str) -> Revision:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            duplicate = db.execute(
                "SELECT * FROM project_revisions WHERE project_id = ? AND mutation_id = ?",
                (mutation.project_id, mutation.mutation_id),
            ).fetchone()
            if duplicate:
                return self._revision_from_row(duplicate)
            project = db.execute(
                "SELECT * FROM shared_projects WHERE project_id = ?", (mutation.project_id,)
            ).fetchone()
            if not project:
                raise KeyError(f"Project {mutation.project_id!r} not found")
            source = json.loads(project["source_json"])
            current_revision = project["current_revision"]
            if mutation.base_revision != current_revision:
                raise MutationConflict(
                    current_revision, mutation.target_id,
                    _find_entity(source, _target_type(mutation.operation), mutation.target_id),
                )
            _update_entity(source, mutation)
            source = sanitize_project_source(source)
            revision = Revision(
                id=str(uuid.uuid4()), project_id=mutation.project_id,
                revision=current_revision + 1, base_revision=current_revision,
                mutation_id=mutation.mutation_id, actor_device_id=actor_device_id,
                operation=mutation.operation, target_type=_target_type(mutation.operation),
                target_id=mutation.target_id, summary=summary,
                patch=copy.deepcopy(mutation.payload), created_at=_now(),
            )
            db.execute(
                "UPDATE shared_projects SET current_revision = ?, source_json = ?, updated_at = ? WHERE project_id = ?",
                (revision.revision, json.dumps(source), revision.created_at, mutation.project_id),
            )
            self._insert_revision(db, revision)
            return revision

    def revisions_after(self, project_id: str, revision: int) -> list[Revision]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM project_revisions WHERE project_id = ? AND revision > ? ORDER BY revision",
                (project_id, revision),
            ).fetchall()
        return [self._revision_from_row(row) for row in rows]

    @staticmethod
    def _insert_revision(db, revision: Revision) -> None:
        db.execute(
            "INSERT INTO project_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (revision.id, revision.project_id, revision.revision, revision.base_revision,
             revision.mutation_id, revision.actor_device_id, revision.operation,
             revision.target_type, revision.target_id, revision.summary,
             json.dumps(revision.patch), revision.created_at),
        )

    @staticmethod
    def _revision_from_row(row) -> Revision:
        return Revision(
            id=row["id"], project_id=row["project_id"], revision=row["revision"],
            base_revision=row["base_revision"], mutation_id=row["mutation_id"],
            actor_device_id=row["actor_device_id"], operation=row["operation"],
            target_type=row["target_type"], target_id=row["target_id"],
            summary=row["summary"], patch=json.loads(row["patch_json"]),
            created_at=row["created_at"],
        )
