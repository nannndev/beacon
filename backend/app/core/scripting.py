"""Pre-request script execution, isolated in worker processes.

Scripts come from project files that can be shared over Git or LAN, so they
are untrusted. They run in a pool of long-lived child processes started with
an empty environment, best-effort OS resource limits, and the restricted
namespace from `script_sandbox.py`. The parent enforces a hard deadline: a
worker that does not answer in time (an infinite loop, a pathological regex)
is killed and replaced, so a script can never stall a run.

Scripts receive a `beacon` proxy to mutate the outgoing request and to
read/write environment variables. Variable writes come back in the returned
context; the caller merges them into the live config under its lock.
"""
from __future__ import annotations

import atexit
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Dict, List, Optional

WORKER_FLAG = "--beacon-script-worker"
# Grace on top of the script's own (in-worker) timeout before the parent
# kills the process: covers worker startup and C-level hangs.
_HARD_TIMEOUT_GRACE_S = 3.0


class PreRequestError(Exception):
    """A script failed to execute — not a server error."""
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class PreRequestTimeout(PreRequestError):
    """Script exceeded the execution time limit."""


def maybe_run_worker(argv: Optional[List[str]] = None) -> None:
    """Frozen entry points call this first: when started as a script worker,
    serve requests and exit instead of booting the app."""
    argv = sys.argv if argv is None else argv
    if WORKER_FLAG in argv[1:]:
        from .script_sandbox import worker_main
        worker_main()
        raise SystemExit(0)


def _worker_command() -> List[str]:
    if getattr(sys, "frozen", False):
        # PyInstaller: sys.executable is the bundled app, which recognizes the flag.
        return [sys.executable, WORKER_FLAG]
    # -I: ignore PYTHON* env vars, user site-packages and the script's dir.
    return [sys.executable, "-I", str(Path(__file__).with_name("script_sandbox.py"))]


def _worker_env() -> Dict[str, str]:
    # No inherited secrets (tokens, cloud credentials) reach the script.
    env = {"PYTHONIOENCODING": "utf-8"}
    if os.name == "nt":
        for key in ("SYSTEMROOT", "TEMP", "TMP"):
            if key in os.environ:
                env[key] = os.environ[key]
    return env


class _Worker:
    def __init__(self):
        self.proc = subprocess.Popen(
            _worker_command(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=_worker_env(),
            cwd=tempfile.gettempdir(),
            text=True,
            encoding="utf-8",
            bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        # Pipes cannot be read with a timeout portably (no select() on Windows
        # pipes), so a reader thread hands lines over through a queue.
        self.lines: "queue.Queue[Optional[str]]" = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.proc.stdout:
                self.lines.put(line)
        except (OSError, ValueError):
            pass
        self.lines.put(None)

    def alive(self) -> bool:
        return self.proc.poll() is None

    def call(self, request: dict, timeout: float) -> dict:
        self.proc.stdin.write(json.dumps(request, default=str) + "\n")
        self.proc.stdin.flush()
        line = self.lines.get(timeout=timeout)
        if line is None:
            raise EOFError("script worker exited")
        return json.loads(line)

    def kill(self):
        try:
            self.proc.kill()
            self.proc.wait(timeout=2)
        except Exception:
            pass


class _WorkerPool:
    def __init__(self, size: int):
        self.size = size
        self._idle: "queue.LifoQueue[_Worker]" = queue.LifoQueue()
        self._lock = threading.Lock()
        self._created = 0
        self._all: List[_Worker] = []

    def _acquire(self) -> _Worker:
        try:
            return self._idle.get_nowait()
        except queue.Empty:
            pass
        with self._lock:
            if self._created < self.size:
                self._created += 1
                try:
                    worker = _Worker()
                except Exception:
                    self._created -= 1
                    raise
                self._all.append(worker)
                return worker
        return self._idle.get()

    def _discard(self, worker: _Worker):
        worker.kill()
        with self._lock:
            self._created -= 1
            if worker in self._all:
                self._all.remove(worker)

    def run(self, request: dict, hard_timeout: float) -> dict:
        try:
            worker = self._acquire()
        except OSError as e:
            raise PreRequestError(f"Could not start the script worker: {e}")
        try:
            if not worker.alive():
                raise EOFError("script worker exited")
            result = worker.call(request, hard_timeout)
        except queue.Empty:
            self._discard(worker)
            raise PreRequestTimeout(f"Script timed out after {request.get('timeout')} seconds")
        except (EOFError, OSError, ValueError) as e:
            self._discard(worker)
            raise PreRequestError(f"Script worker failed: {e}")
        except BaseException:
            self._discard(worker)
            raise
        self._idle.put(worker)
        return result

    def shutdown(self):
        with self._lock:
            workers, self._all = self._all, []
            self._created = 0
        for worker in workers:
            worker.kill()


_pool = _WorkerPool(size=max(1, min(4, os.cpu_count() or 1)))
atexit.register(_pool.shutdown)


class PreRequestEngine:
    def execute(self, script: str, context: dict, timeout: int = 5) -> dict:
        """Execute a pre-request script and return the mutated context.

        The context dict must contain: url, method, headers, body, and
        optionally variables. It is updated in place with the script's
        changes and also returned.
        """
        request = {
            "script": script,
            "timeout": timeout,
            "context": {
                "url": context.get("url"),
                "method": context.get("method"),
                "headers": context.get("headers") or {},
                "body": context.get("body"),
                "variables": context.get("variables") or {},
            },
        }
        result = _pool.run(request, hard_timeout=timeout + _HARD_TIMEOUT_GRACE_S)
        if not result.get("ok"):
            error_cls = PreRequestTimeout if result.get("kind") == "timeout" else PreRequestError
            raise error_cls(result.get("error") or "Script failed")
        context.update(result.get("context") or {})
        return context


__all__ = ["PreRequestEngine", "PreRequestError", "PreRequestTimeout", "maybe_run_worker"]
