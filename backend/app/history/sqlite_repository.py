"""SQLite persistence for sanitized run history records."""

import base64
import json
import os
import glob
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Optional

from .models import RunEvent, RunMetrics, RunSample, RunStart, RunStepStart


SCHEMA_VERSION = 1


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _encode_cursor(started_at: str, run_id: str) -> str:
    raw = json.dumps([started_at, run_id], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[str, str]:
    padded = cursor + "=" * (-len(cursor) % 4)
    started_at, run_id = json.loads(base64.urlsafe_b64decode(padded).decode())
    return str(started_at), str(run_id)


class SqliteRunHistoryRepository:
    def __init__(self, path: str):
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @contextmanager
    def _session(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        directory = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(directory, exist_ok=True)
        with self._session() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS history_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    project_name TEXT NOT NULL,
                    origin_device_id TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    target_id TEXT,
                    target_name TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    status TEXT NOT NULL,
                    label TEXT,
                    is_pinned INTEGER NOT NULL DEFAULT 0,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    duration_ms INTEGER,
                    config_snapshot_json TEXT NOT NULL,
                    schema_version INTEGER NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE TABLE IF NOT EXISTS run_steps (
                    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    endpoint_id TEXT NOT NULL,
                    endpoint_name TEXT NOT NULL,
                    method TEXT NOT NULL,
                    url_template TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    success INTEGER NOT NULL DEFAULT 0,
                    rate_limited INTEGER NOT NULL DEFAULT 0,
                    errors INTEGER NOT NULL DEFAULT 0,
                    average_rps REAL NOT NULL DEFAULT 0,
                    peak_rps REAL NOT NULL DEFAULT 0,
                    min_latency_ms REAL,
                    average_latency_ms REAL,
                    p50_ms REAL,
                    p95_ms REAL,
                    p99_ms REAL,
                    max_latency_ms REAL,
                    PRIMARY KEY (run_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS run_metrics (
                    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    success INTEGER NOT NULL DEFAULT 0,
                    rate_limited INTEGER NOT NULL DEFAULT 0,
                    errors INTEGER NOT NULL DEFAULT 0,
                    average_rps REAL NOT NULL DEFAULT 0,
                    peak_rps REAL NOT NULL DEFAULT 0,
                    min_latency_ms REAL,
                    average_latency_ms REAL,
                    p50_ms REAL,
                    p95_ms REAL,
                    p99_ms REAL,
                    max_latency_ms REAL
                );
                CREATE TABLE IF NOT EXISTS run_samples (
                    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    elapsed_ms INTEGER NOT NULL,
                    attempts INTEGER NOT NULL,
                    success INTEGER NOT NULL,
                    rate_limited INTEGER NOT NULL,
                    errors INTEGER NOT NULL,
                    instantaneous_rps REAL NOT NULL,
                    latency_ms REAL,
                    PRIMARY KEY (run_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS run_events (
                    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    elapsed_ms INTEGER NOT NULL,
                    outcome TEXT NOT NULL,
                    status_code INTEGER,
                    latency_ms REAL,
                    error_category TEXT,
                    message TEXT,
                    PRIMARY KEY (run_id, sequence)
                );
                CREATE INDEX IF NOT EXISTS idx_runs_project_started ON runs(project_id, started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_runs_project_pin_started ON runs(project_id, is_pinned, started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_runs_mode_started ON runs(mode, started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
                CREATE INDEX IF NOT EXISTS idx_runs_workspace_revision ON runs(workspace_id, revision);
                """
            )
            now = _utc_now()
            connection.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                (SCHEMA_VERSION, now),
            )
            for key, value in (
                ("workspace_id", str(uuid.uuid4())),
                ("origin_device_id", str(uuid.uuid4())),
                ("created_at", now),
                ("schema_version", str(SCHEMA_VERSION)),
            ):
                connection.execute(
                    "INSERT OR IGNORE INTO history_meta(key, value) VALUES (?, ?)",
                    (key, value),
                )

    def pragma(self, name: str) -> Any:
        if name not in {"journal_mode", "foreign_keys", "busy_timeout"}:
            raise ValueError("Unsupported PRAGMA")
        with self._session() as connection:
            return connection.execute(f"PRAGMA {name}").fetchone()[0]

    def metadata(self) -> dict[str, str]:
        with self._session() as connection:
            return {
                row["key"]: row["value"]
                for row in connection.execute("SELECT key, value FROM history_meta")
            }

    def create_run(self, run: RunStart, steps: list[RunStepStart]) -> None:
        now = _utc_now()
        with self._session() as connection:
            connection.execute(
                """
                INSERT INTO runs(
                    id, workspace_id, project_id, project_name, origin_device_id,
                    source_type, target_id, target_name, mode, status, label,
                    is_pinned, started_at, config_snapshot_json, schema_version,
                    revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    run.id, run.workspace_id, run.project_id, run.project_name,
                    run.origin_device_id, run.source_type, run.target_id,
                    run.target_name, run.mode, run.label, int(run.is_pinned), now,
                    json.dumps(run.config_snapshot, separators=(",", ":")),
                    SCHEMA_VERSION, now, now,
                ),
            )
            for step in steps:
                self._insert_step(connection, run.id, step)

    def _insert_step(self, connection: sqlite3.Connection, run_id: str, step: RunStepStart) -> None:
        connection.execute(
            """
            INSERT INTO run_steps(
                run_id, sequence, endpoint_id, endpoint_name, method, url_template
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (run_id, step.sequence, step.endpoint_id, step.endpoint_name, step.method, step.url_template),
        )

    def add_step(self, run_id: str, step: RunStepStart) -> None:
        with self._session() as connection:
            self._insert_step(connection, run_id, step)

    @staticmethod
    def _metric_values(metrics: RunMetrics) -> tuple:
        data = asdict(metrics)
        return tuple(data[key] for key in (
            "attempts", "success", "rate_limited", "errors", "average_rps",
            "peak_rps", "min_latency_ms", "average_latency_ms", "p50_ms",
            "p95_ms", "p99_ms", "max_latency_ms",
        ))

    def finalize_step(self, run_id: str, sequence: int, status: str, metrics: RunMetrics) -> None:
        with self._session() as connection:
            connection.execute(
                """
                UPDATE run_steps SET status=?, attempts=?, success=?, rate_limited=?,
                    errors=?, average_rps=?, peak_rps=?, min_latency_ms=?,
                    average_latency_ms=?, p50_ms=?, p95_ms=?, p99_ms=?, max_latency_ms=?
                WHERE run_id=? AND sequence=?
                """,
                (status, *self._metric_values(metrics), run_id, sequence),
            )

    def finalize_run(
        self,
        run_id: str,
        status: str,
        metrics: RunMetrics,
        samples: list[RunSample] | tuple[RunSample, ...] = (),
        events: list[RunEvent] | tuple[RunEvent, ...] = (),
    ) -> None:
        completed_at = _utc_now()
        with self._session() as connection:
            row = connection.execute("SELECT started_at FROM runs WHERE id=?", (run_id,)).fetchone()
            if row is None:
                return
            started = datetime.fromisoformat(row["started_at"])
            duration_ms = max(0, int((datetime.fromisoformat(completed_at) - started).total_seconds() * 1000))
            connection.execute(
                """
                UPDATE runs SET status=?, completed_at=?, duration_ms=?, updated_at=?,
                    revision=revision+1 WHERE id=?
                """,
                (status, completed_at, duration_ms, completed_at, run_id),
            )
            connection.execute(
                """
                INSERT INTO run_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    attempts=excluded.attempts, success=excluded.success,
                    rate_limited=excluded.rate_limited, errors=excluded.errors,
                    average_rps=excluded.average_rps, peak_rps=excluded.peak_rps,
                    min_latency_ms=excluded.min_latency_ms,
                    average_latency_ms=excluded.average_latency_ms,
                    p50_ms=excluded.p50_ms, p95_ms=excluded.p95_ms,
                    p99_ms=excluded.p99_ms, max_latency_ms=excluded.max_latency_ms
                """,
                (run_id, *self._metric_values(metrics)),
            )
            connection.execute("DELETE FROM run_samples WHERE run_id=?", (run_id,))
            connection.executemany(
                """INSERT INTO run_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        run_id, sample.sequence, sample.elapsed_ms, sample.attempts,
                        sample.success, sample.rate_limited, sample.errors,
                        sample.instantaneous_rps, sample.latency_ms,
                    )
                    for sample in samples[:300]
                ],
            )
            connection.execute("DELETE FROM run_events WHERE run_id=?", (run_id,))
            connection.executemany(
                """INSERT INTO run_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        run_id, index, event.elapsed_ms, event.outcome,
                        event.status_code, event.latency_ms, event.error_category,
                        event.message,
                    )
                    for index, event in enumerate(events[:200])
                ],
            )

    @staticmethod
    def _project_run(row: sqlite3.Row) -> dict:
        result = dict(row)
        result["is_pinned"] = bool(result.get("is_pinned"))
        if "config_snapshot_json" in result:
            result["config_snapshot"] = json.loads(result.pop("config_snapshot_json") or "{}")
        return result

    def list_runs(self, filters: Optional[dict] = None, cursor: Optional[str] = None, limit: int = 30) -> dict:
        filters = filters or {}
        limit = max(1, min(int(limit), 1000))
        clauses = ["r.deleted_at IS NULL"]
        params: list[Any] = []
        for key in ("project_id", "mode", "status", "source_type"):
            value = filters.get(key)
            if value is not None:
                clauses.append(f"r.{key}=?")
                params.append(value)
        pinned = filters.get("is_pinned", filters.get("pinned"))
        if pinned is not None:
            clauses.append("r.is_pinned=?")
            params.append(int(bool(pinned)))
        if filters.get("date_from"):
            clauses.append("r.started_at>=?")
            params.append(filters["date_from"])
        if filters.get("date_to"):
            clauses.append("r.started_at<=?")
            params.append(filters["date_to"])
        if filters.get("search"):
            clauses.append("(r.target_name LIKE ? OR COALESCE(r.label, '') LIKE ? OR r.project_name LIKE ?)")
            search = f"%{filters['search']}%"
            params.extend([search, search, search])
        if cursor:
            started_at, run_id = _decode_cursor(cursor)
            clauses.append("(r.started_at < ? OR (r.started_at = ? AND r.id < ?))")
            params.extend([started_at, started_at, run_id])
        query = f"""
            SELECT r.*, m.attempts, m.success, m.rate_limited, m.errors,
                   m.average_rps, m.peak_rps, m.p50_ms, m.p95_ms, m.p99_ms
            FROM runs r LEFT JOIN run_metrics m ON m.run_id=r.id
            WHERE {' AND '.join(clauses)}
            ORDER BY r.started_at DESC, r.id DESC LIMIT ?
        """
        params.append(limit + 1)
        with self._session() as connection:
            rows = connection.execute(query, params).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        items = [self._project_run(row) for row in rows]
        next_cursor = _encode_cursor(rows[-1]["started_at"], rows[-1]["id"]) if has_more and rows else None
        return {"items": items, "next_cursor": next_cursor}

    def get_run(self, run_id: str) -> Optional[dict]:
        with self._session() as connection:
            run = connection.execute("SELECT * FROM runs WHERE id=? AND deleted_at IS NULL", (run_id,)).fetchone()
            if run is None:
                return None
            result = self._project_run(run)
            metrics = connection.execute("SELECT * FROM run_metrics WHERE run_id=?", (run_id,)).fetchone()
            result["metrics"] = dict(metrics) if metrics else asdict(RunMetrics())
            if metrics:
                result["metrics"].pop("run_id", None)
            result["steps"] = [dict(row) for row in connection.execute(
                "SELECT * FROM run_steps WHERE run_id=? ORDER BY sequence", (run_id,)
            )]
            result["samples"] = [dict(row) for row in connection.execute(
                "SELECT * FROM run_samples WHERE run_id=? ORDER BY sequence", (run_id,)
            )]
            result["events"] = [dict(row) for row in connection.execute(
                "SELECT * FROM run_events WHERE run_id=? ORDER BY sequence", (run_id,)
            )]
            for collection in (result["steps"], result["samples"], result["events"]):
                for item in collection:
                    item.pop("run_id", None)
            return result

    def update_run(self, run_id: str, label: Optional[str] = None, is_pinned: Optional[bool] = None) -> bool:
        assignments = []
        params: list[Any] = []
        if label is not None:
            assignments.append("label=?")
            params.append(label[:120])
        if is_pinned is not None:
            assignments.append("is_pinned=?")
            params.append(int(is_pinned))
        if not assignments:
            return False
        assignments.extend(["updated_at=?", "revision=revision+1"])
        params.extend([_utc_now(), run_id])
        with self._session() as connection:
            cursor = connection.execute(
                f"UPDATE runs SET {', '.join(assignments)} WHERE id=?", params
            )
            return cursor.rowcount > 0

    def delete_run(self, run_id: str) -> bool:
        with self._session() as connection:
            cursor = connection.execute("DELETE FROM runs WHERE id=?", (run_id,))
            return cursor.rowcount > 0

    def mark_interrupted(self, origin_device_id: str) -> int:
        now = _utc_now()
        with self._session() as connection:
            cursor = connection.execute(
                """UPDATE runs SET status='interrupted', completed_at=?, updated_at=?,
                   revision=revision+1 WHERE status='running' AND origin_device_id=?""",
                (now, now, origin_device_id),
            )
            return cursor.rowcount

    def enforce_retention(self, project_id: str, keep: int = 100) -> int:
        with self._session() as connection:
            rows = connection.execute(
                """SELECT id FROM runs WHERE project_id=? AND is_pinned=0
                   ORDER BY started_at DESC, id DESC LIMIT -1 OFFSET ?""",
                (project_id, keep),
            ).fetchall()
            if rows:
                connection.executemany("DELETE FROM runs WHERE id=?", [(row["id"],) for row in rows])
            return len(rows)

    def backup_exists(self) -> bool:
        return bool(glob.glob(f"{self.path}.backup-*.db"))

    def rebuild(self) -> Optional[str]:
        """Preserve the old database and create a fresh schema."""
        backup = None
        if os.path.exists(self.path):
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup = f"{self.path}.backup-{stamp}.db"
            try:
                with self._session() as connection:
                    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except Exception:
                pass
            os.replace(self.path, backup)
            for suffix in ("-wal", "-shm"):
                sibling = self.path + suffix
                if os.path.exists(sibling):
                    os.replace(sibling, backup + suffix)
        self.initialize()
        return backup
