"""Inspect a source repository for importable API descriptions without executing it."""
from __future__ import annotations

import os
from pathlib import Path, PurePosixPath
from typing import Any

from .project_importer import ProjectImportError, normalize_project


class ProjectRepositoryInspectionError(ValueError):
    """A repository cannot be inspected or a candidate cannot be read safely."""


class ProjectRepositoryInspector:
    MAX_FILES = 500
    MAX_CANDIDATES = 20
    MAX_FILE_BYTES = 5 * 1024 * 1024
    EXTENSIONS = {".json", ".yaml", ".yml", ".har"}
    IGNORED_DIRECTORIES = {
        ".git", ".beacon", ".venv", "venv", "node_modules", "vendor",
        "dist", "build", "coverage", ".next", ".nuxt", "target",
    }

    @staticmethod
    def _root(raw_path: str) -> Path:
        root = Path(raw_path or "").expanduser()
        if not root.is_absolute() or not root.is_dir():
            raise ProjectRepositoryInspectionError("Repository path must be an absolute directory")
        return root.resolve()

    @staticmethod
    def _candidate_path(root: Path, raw_path: str) -> Path:
        relative = PurePosixPath(str(raw_path or ""))
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            raise ProjectRepositoryInspectionError("Invalid repository candidate path")
        candidate = root.joinpath(*relative.parts).resolve(strict=False)
        try:
            candidate.relative_to(root)
        except ValueError as error:
            raise ProjectRepositoryInspectionError("Repository candidate escapes the cloned folder") from error
        if not candidate.is_file():
            raise ProjectRepositoryInspectionError("The selected API file no longer exists")
        return candidate

    def _preview(self, root: Path, file_path: Path) -> dict[str, Any] | None:
        try:
            if file_path.stat().st_size > self.MAX_FILE_BYTES:
                return None
            content = file_path.read_text(encoding="utf-8")
            report = normalize_project({
                "content": content,
                "filename": file_path.name,
            })
        except (OSError, UnicodeError, ProjectImportError):
            return None
        return {
            "path": file_path.relative_to(root).as_posix(),
            "format": report["format"],
            "format_label": report["format_label"],
            "summary": report["summary"],
            "warnings": report["warnings"],
        }

    def inspect(self, raw_path: str) -> dict[str, Any]:
        root = self._root(raw_path)
        if (root / "beacon.yaml").is_file():
            return {
                "mode": "beacon_project",
                "repository_path": str(root),
                "repository_name": root.name,
                "candidates": [],
            }

        candidates = []
        checked = 0
        try:
            stop = False
            for directory, names, files in os.walk(root):
                names[:] = sorted(name for name in names if name not in self.IGNORED_DIRECTORIES)
                for filename in sorted(files):
                    if checked >= self.MAX_FILES or len(candidates) >= self.MAX_CANDIDATES:
                        stop = True
                        break
                    path = Path(directory) / filename
                    if path.suffix.lower() not in self.EXTENSIONS:
                        continue
                    checked += 1
                    preview = self._preview(root, path)
                    if preview:
                        candidates.append(preview)
                if stop:
                    break
        except OSError as error:
            raise ProjectRepositoryInspectionError(f"Could not inspect repository: {error}") from error

        candidates.sort(key=lambda item: (
            0 if item["format"] in {"openapi3", "swagger2"} else 1,
            item["path"].count("/"),
            item["path"].lower(),
        ))
        return {
            "mode": "import_candidates" if candidates else "empty_repository",
            "repository_path": str(root),
            "repository_name": root.name,
            "candidates": candidates,
        }

    def load_candidate(self, raw_path: str, candidate_path: str) -> dict[str, Any]:
        root = self._root(raw_path)
        candidate = self._candidate_path(root, candidate_path)
        if candidate.suffix.lower() not in self.EXTENSIONS:
            raise ProjectRepositoryInspectionError("Unsupported API file type")
        try:
            content = candidate.read_text(encoding="utf-8")
            return normalize_project({"content": content, "filename": candidate.name})
        except (OSError, UnicodeError) as error:
            raise ProjectRepositoryInspectionError(f"Could not read API file: {error}") from error
        except ProjectImportError as error:
            raise ProjectRepositoryInspectionError(str(error)) from error
