"""Small, constrained Git client for linked Beacon project folders."""
from __future__ import annotations

import os
import signal
import shutil
import subprocess
import difflib
import re
import yaml
from pathlib import Path
from pathlib import PurePosixPath


class ProjectGitError(ValueError):
    """A supported Git operation could not be completed safely."""


class ProjectGitService:
    TIMEOUT = 45
    MANAGED_PATHS = ("beacon.yaml", "endpoints", "environments", ".gitignore")
    MAX_PATCH_BYTES = 256_000

    def _root(self, project: dict) -> Path:
        metadata = project.get("file_sync")
        root = Path(str((metadata or {}).get("path") or ""))
        if not root.is_absolute() or not root.is_dir() or not (root / "beacon.yaml").is_file():
            raise ProjectGitError("Link this project to a valid folder before using Git")
        return root.resolve()

    def _run(self, root: Path, *args: str, timeout: int | None = None) -> str:
        if not shutil.which("git"):
            raise ProjectGitError("Git is not installed or is not available in PATH")
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        # Git can otherwise leave an SSH child waiting for a passphrase or host
        # prompt after the parent command times out. Existing ssh-agent keys
        # still work; interactive prompts fail quickly with an actionable error.
        env["GIT_SSH_COMMAND"] = (
            "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "
            "-o ConnectTimeout=10 -o ConnectionAttempts=1"
        )
        popen_options = {
            "cwd": root,
            "env": env,
            "shell": False,
            "text": True,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
        }
        if os.name == "nt":
            popen_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_options["start_new_session"] = True
        try:
            process = subprocess.Popen(["git", *args], **popen_options)
            stdout, stderr = process.communicate(timeout=timeout or self.TIMEOUT)
        except subprocess.TimeoutExpired as error:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    capture_output=True, check=False, timeout=5,
                )
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.communicate()
            raise ProjectGitError("Git connection timed out. Check the remote URL, network, and device credentials") from error
        if process.returncode:
            detail = (stderr or stdout).strip()
            lowered = detail.lower()
            if "repository not found" in lowered:
                detail = "Remote repository was not found. Check the origin URL and your repository access"
            elif "permission denied (publickey)" in lowered:
                detail = (
                    "GitHub rejected this SSH key. Add the device key to GitHub, or change origin "
                    "from git@github.com:… to https://github.com/… to use GitHub CLI credentials"
                )
            elif any(marker in lowered for marker in (
                "terminal prompts disabled", "authentication failed", "could not read from remote repository",
            )):
                detail = "Git authentication failed. Sign in with your device's Git credential manager or SSH key"
            elif "host key verification failed" in lowered:
                detail = "The Git host identity could not be verified. Check your SSH known_hosts configuration"
            raise ProjectGitError(detail or f"git {args[0]} failed")
        # Porcelain status uses meaningful leading spaces (for example
        # `` M beacon.yaml``). Keep them while trimming trailing newlines.
        return stdout.rstrip()

    def _is_repo(self, root: Path) -> bool:
        try:
            self._run(root, "rev-parse", "--is-inside-work-tree")
            return True
        except ProjectGitError:
            return False

    def _all_changes(self, root: Path) -> list[str]:
        """Return every repository change, including files Beacon does not manage."""
        output = self._run(root, "status", "--porcelain=v1", "--untracked-files=all")
        return [line for line in output.splitlines() if line]

    def _require_clean_switch(self, root: Path) -> None:
        changes = self._all_changes(root)
        if not changes:
            return
        paths = [line[3:].strip('"') if len(line) > 3 else line for line in changes[:3]]
        suffix = f" (including {', '.join(paths)}{'…' if len(changes) > 3 else ''})"
        raise ProjectGitError(
            "Commit, stash, or discard all repository changes before switching branches" + suffix
        )

    def _validate_branch_name(self, root: Path, name: str) -> str:
        name = (name or "").strip()
        if not name or len(name) > 200 or "\n" in name or "\r" in name:
            raise ProjectGitError("Enter a valid branch name")
        self._run(root, "check-ref-format", "--branch", name)
        return name

    def _validate_project_on_ref(self, root: Path, ref: str, project_id: str) -> None:
        try:
            manifest = yaml.safe_load(self._run(root, "show", f"{ref}:beacon.yaml"))
        except (ProjectGitError, yaml.YAMLError) as error:
            raise ProjectGitError("That branch does not contain a valid Beacon project") from error
        linked_id = str(((manifest or {}).get("project") or {}).get("id") or "")
        if (manifest or {}).get("format") != "beacon.project" or (manifest or {}).get("version") != 1:
            raise ProjectGitError("That branch does not contain a supported Beacon project")
        if linked_id != str(project_id):
            raise ProjectGitError("That branch belongs to a different Beacon project")

    def branches(self, project: dict) -> dict:
        root = self._root(project)
        if not self._is_repo(root):
            raise ProjectGitError("Initialize Git before managing branches")
        current = self._run(root, "branch", "--show-current") or None
        local = []
        raw_local = self._run(
            root, "for-each-ref", "--format=%(refname:short)%00%(upstream:short)%00%(HEAD)", "refs/heads",
        )
        local_names: set[str] = set()
        for line in raw_local.splitlines():
            fields = line.split("\0")
            if not fields or not fields[0]:
                continue
            name = fields[0]
            local_names.add(name)
            local.append({
                "name": name, "full_name": name, "kind": "local", "current": name == current,
                "upstream": fields[1] or None if len(fields) > 1 else None,
            })

        remote = []
        raw_remote = self._run(root, "for-each-ref", "--format=%(refname:short)", "refs/remotes")
        for name in raw_remote.splitlines():
            if not name or name.endswith("/HEAD"):
                continue
            local_name = name.split("/", 1)[1] if "/" in name else name
            remote.append({
                "name": local_name, "full_name": name, "kind": "remote", "current": False,
                "upstream": None, "local_name": local_name if local_name in local_names else None,
            })
        remote_url = None
        try:
            remote_url = self._run(root, "remote", "get-url", "origin") or None
        except ProjectGitError:
            pass
        return {"current": current, "remote_url": remote_url, "local": local, "remote": remote}

    def fetch(self, project: dict) -> dict:
        root = self._root(project)
        branch_state = self.branches(project)
        if not branch_state["remote_url"]:
            raise ProjectGitError("Add an origin remote before fetching branches")
        self._run(root, "fetch", "--prune", "origin", timeout=45)
        return self.branches(project)

    def create_branch(self, project: dict, name: str) -> dict:
        root = self._root(project)
        if not self._is_repo(root):
            raise ProjectGitError("Initialize Git before creating a branch")
        self._require_clean_switch(root)
        name = self._validate_branch_name(root, name)
        self._run(root, "switch", "-c", name)
        return self.branches(project)

    def _resolve_branch_target(
        self, root: Path, target: str, branch_state: dict,
    ) -> tuple[str, tuple[str, ...]]:
        target = (target or "").strip()
        local_names = {item["name"] for item in branch_state["local"]}
        remote_by_ref = {item["full_name"]: item for item in branch_state["remote"]}
        if target in local_names:
            return target, ("switch", target)
        if target in remote_by_ref:
            item = remote_by_ref[target]
            local_name = item["name"]
            if local_name in local_names:
                return local_name, ("switch", local_name)
            self._validate_branch_name(root, local_name)
            return target, ("switch", "--track", "-c", local_name, target)
        raise ProjectGitError("Refresh branches and choose an available local or remote branch")

    def compare_branch(self, project: dict, target: str) -> dict:
        root = self._root(project)
        if not self._is_repo(root):
            raise ProjectGitError("Initialize Git before comparing branches")
        branch_state = self.branches(project)
        current = branch_state["current"]
        ref, _ = self._resolve_branch_target(root, target, branch_state)
        self._validate_project_on_ref(root, ref, str(project.get("id") or ""))
        if ref == current:
            return {
                "current": current, "target": target, "current_only_commits": 0,
                "target_only_commits": 0, "files": [],
                "summary": {"added": 0, "modified": 0, "deleted": 0},
            }

        current_only = target_only = 0
        try:
            counts = self._run(root, "rev-list", "--left-right", "--count", f"HEAD...{ref}").split()
            if len(counts) == 2:
                current_only, target_only = int(counts[0]), int(counts[1])
        except (ProjectGitError, ValueError):
            pass

        stats: dict[str, tuple[int, int]] = {}
        numstat = self._run(
            root, "diff", "--numstat", "--no-renames", "HEAD", ref, "--", *self.MANAGED_PATHS,
        )
        for line in numstat.splitlines():
            fields = line.split("\t", 2)
            if len(fields) != 3:
                continue
            additions = int(fields[0]) if fields[0].isdigit() else 0
            deletions = int(fields[1]) if fields[1].isdigit() else 0
            stats[fields[2]] = (additions, deletions)

        files = []
        summary = {"added": 0, "modified": 0, "deleted": 0}
        names = self._run(
            root, "diff", "--name-status", "--no-renames", "HEAD", ref, "--", *self.MANAGED_PATHS,
        )
        labels = {"A": "added", "D": "deleted", "M": "modified"}
        for line in names.splitlines():
            fields = line.split("\t", 1)
            if len(fields) != 2:
                continue
            status = labels.get(fields[0][:1], "modified")
            path = self._managed_file(fields[1])
            additions, deletions = stats.get(path, (0, 0))
            summary[status] += 1
            files.append({
                "path": path, "status": status, "additions": additions, "deletions": deletions,
            })
        return {
            "current": current, "target": target, "current_only_commits": current_only,
            "target_only_commits": target_only, "files": files, "summary": summary,
        }

    def switch_branch(self, project: dict, target: str) -> dict:
        root = self._root(project)
        if not self._is_repo(root):
            raise ProjectGitError("Initialize Git before switching branches")
        self._require_clean_switch(root)
        branch_state = self.branches(project)
        if target == branch_state["current"]:
            return branch_state
        ref, command = self._resolve_branch_target(root, target, branch_state)
        self._validate_project_on_ref(root, ref, str(project.get("id") or ""))
        self._run(root, *command)
        return self.branches(project)

    def status(self, project: dict) -> dict:
        root = self._root(project)
        available = bool(shutil.which("git"))
        if not available:
            return {"available": False, "repository": False, "branch": None, "remote_url": None,
                    "upstream": None, "ahead": 0, "behind": 0, "changes": [],
                    "message": "Git is not installed or is not available in PATH"}
        if not self._is_repo(root):
            return {"available": True, "repository": False, "branch": None, "remote_url": None,
                    "upstream": None, "ahead": 0, "behind": 0, "changes": [],
                    "message": "This linked folder is not a Git repository yet"}

        branch = self._run(root, "branch", "--show-current") or None
        remote_url = None
        try:
            remote_url = self._run(root, "remote", "get-url", "origin") or None
        except ProjectGitError:
            pass
        upstream = None
        ahead = behind = 0
        try:
            upstream = self._run(root, "rev-parse", "--abbrev-ref", "@{upstream}") or None
            counts = self._run(root, "rev-list", "--left-right", "--count", "HEAD...@{upstream}").split()
            if len(counts) == 2:
                ahead, behind = int(counts[0]), int(counts[1])
        except (ProjectGitError, ValueError):
            pass

        changes = []
        output = self._run(root, "status", "--porcelain=v1", "--untracked-files=all", "--", *self.MANAGED_PATHS)
        for line in output.splitlines():
            if len(line) < 4:
                continue
            code, path = line[:2], line[3:]
            if " -> " in path:
                path = path.split(" -> ", 1)[1]
            changes.append({"path": path.strip('"'), "status": code.strip() or "modified"})
        return {
            "available": True, "repository": True, "branch": branch, "remote_url": remote_url,
            "upstream": upstream, "ahead": ahead, "behind": behind, "changes": changes,
            "message": "Working tree is clean" if not changes else f"{len(changes)} file change{'s' if len(changes) != 1 else ''}",
        }

    def init(self, project: dict) -> dict:
        root = self._root(project)
        if not self._is_repo(root):
            self._run(root, "init", "-b", "main")
        return self.status(project)

    def clone(self, remote_url: str, raw_parent: str) -> Path:
        remote_url = (remote_url or "").strip()
        if not remote_url or len(remote_url) > 2048 or "\n" in remote_url or "\r" in remote_url:
            raise ProjectGitError("Enter a valid Git repository URL")
        parent = Path(raw_parent or "").expanduser()
        if not parent.is_absolute() or not parent.is_dir():
            raise ProjectGitError("Choose an existing destination folder")
        raw_name = remote_url.rstrip("/").rsplit("/", 1)[-1]
        raw_name = raw_name.rsplit(":", 1)[-1] if "/" not in raw_name else raw_name
        if raw_name.endswith(".git"):
            raw_name = raw_name[:-4]
        name = re.sub(r"[^A-Za-z0-9._-]+", "-", raw_name).strip(".-")
        if not name:
            raise ProjectGitError("Could not determine the repository folder name")
        target = parent.resolve() / name
        if target.exists():
            raise ProjectGitError(f"Destination already exists: {target}")
        self._run(parent.resolve(), "clone", "--", remote_url, str(target), timeout=120)
        return target

    def set_remote(self, project: dict, url: str) -> dict:
        root = self._root(project)
        if not self._is_repo(root):
            raise ProjectGitError("Initialize Git before adding a remote")
        url = (url or "").strip()
        if not url or len(url) > 2048 or "\n" in url or "\r" in url:
            raise ProjectGitError("Enter a valid Git remote URL")
        try:
            self._run(root, "remote", "get-url", "origin")
            self._run(root, "remote", "set-url", "origin", url)
        except ProjectGitError:
            self._run(root, "remote", "add", "origin", url)
        return self.status(project)

    def commit(self, project: dict, message: str) -> dict:
        root = self._root(project)
        if not self._is_repo(root):
            raise ProjectGitError("Initialize Git before committing")
        message = (message or "").strip()
        if not message or len(message) > 200 or "\n" in message or "\r" in message:
            raise ProjectGitError("Commit message must be one line and no longer than 200 characters")
        self._run(root, "add", "-A", "--", *self.MANAGED_PATHS)
        staged = self._run(root, "diff", "--cached", "--name-only")
        if not staged:
            raise ProjectGitError("No Beacon project changes to commit")
        self._run(root, "commit", "-m", message)
        return self.status(project)

    def pull(self, project: dict) -> dict:
        root = self._root(project)
        current = self.status(project)
        if current["changes"]:
            raise ProjectGitError("Commit or discard local Git changes before pulling")
        if not current["upstream"]:
            raise ProjectGitError("Set a remote and push this branch once before pulling")
        self._run(root, "pull", "--ff-only", timeout=30)
        return self.status(project)

    def push(self, project: dict) -> dict:
        root = self._root(project)
        current = self.status(project)
        if not current["remote_url"]:
            raise ProjectGitError("Add an origin remote before pushing")
        if not current["branch"]:
            raise ProjectGitError("Create a commit on a branch before pushing")
        if current["upstream"]:
            self._run(root, "push", timeout=30)
        else:
            self._run(root, "push", "-u", "origin", current["branch"], timeout=30)
        return self.status(project)

    @classmethod
    def _managed_file(cls, raw_path: str) -> str:
        path = PurePosixPath(str(raw_path))
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise ProjectGitError("Invalid Git diff path")
        normalized = path.as_posix()
        allowed = normalized in {"beacon.yaml", ".gitignore"} or (
            len(path.parts) >= 2
            and path.parts[0] in {"endpoints", "environments"}
            and normalized.endswith(".yaml")
        )
        if not allowed:
            raise ProjectGitError("Diff preview is limited to public Beacon project files")
        return normalized

    @staticmethod
    def _patch_counts(patch: str) -> tuple[int, int]:
        additions = deletions = 0
        for line in patch.splitlines():
            if line.startswith("+++") or line.startswith("---"):
                continue
            if line.startswith("+"):
                additions += 1
            elif line.startswith("-"):
                deletions += 1
        return additions, deletions

    def _untracked_patch(self, root: Path, relative: str) -> str:
        target = (root / relative).resolve()
        try:
            target.relative_to(root)
            data = target.read_bytes()
        except (OSError, ValueError):
            return ""
        if b"\0" in data:
            return "Binary file preview is unavailable"
        lines = data.decode("utf-8", errors="replace").splitlines(keepends=True)
        return "".join(difflib.unified_diff([], lines, fromfile="/dev/null", tofile=f"b/{relative}"))

    def diff(self, project: dict, scope: str = "working", selected_path: str | None = None) -> dict:
        root = self._root(project)
        current = self.status(project)
        if not current["repository"]:
            raise ProjectGitError("Initialize Git before viewing changes")
        if scope not in {"working", "last_commit"}:
            raise ProjectGitError("Diff scope must be working or last_commit")

        commit = None
        if scope == "working":
            changed = [{"path": self._managed_file(item["path"]), "status": item["status"]} for item in current["changes"]]
        else:
            try:
                raw_commit = self._run(root, "show", "-s", "--format=%H%x00%h%x00%s%x00%an%x00%cI", "HEAD")
                digest, short, subject, author, committed_at = raw_commit.split("\0", 4)
                commit = {"id": digest, "short_id": short, "subject": subject, "author": author, "committed_at": committed_at}
                names = self._run(root, "diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "HEAD", "--", *self.MANAGED_PATHS)
            except (ProjectGitError, ValueError) as error:
                raise ProjectGitError("Create the first commit before viewing commit history") from error
            changed = []
            for line in names.splitlines():
                fields = line.split("\t")
                if len(fields) >= 2:
                    changed.append({"path": self._managed_file(fields[-1]), "status": fields[0]})

        if selected_path:
            selected_path = self._managed_file(selected_path)
            if selected_path not in {item["path"] for item in changed}:
                raise ProjectGitError("That file is not part of the selected change set")
            changed = [item for item in changed if item["path"] == selected_path]

        files = []
        for item in changed:
            relative = item["path"]
            if scope == "last_commit":
                patch = self._run(root, "show", "--format=", "--no-ext-diff", "--unified=3", "HEAD", "--", relative)
            else:
                try:
                    patch = self._run(root, "diff", "HEAD", "--no-ext-diff", "--unified=3", "--", relative)
                except ProjectGitError:
                    patch = ""
                if not patch and item["status"] == "??":
                    patch = self._untracked_patch(root, relative)
            encoded = patch.encode("utf-8")
            truncated = len(encoded) > self.MAX_PATCH_BYTES
            if truncated:
                patch = encoded[: self.MAX_PATCH_BYTES].decode("utf-8", errors="ignore") + "\n… diff truncated …"
            additions, deletions = self._patch_counts(patch)
            files.append({**item, "patch": patch, "additions": additions, "deletions": deletions, "truncated": truncated})

        return {"scope": scope, "commit": commit, "files": files}
