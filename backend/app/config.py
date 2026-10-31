"""Runtime configuration derived from the single root `.env`.

Ports live in ONE place (repo-root `.env`) so the backend, the Vite proxy,
and the docs server can never drift apart. Real environment variables always
win over the file, so containers / CI can override without editing anything.
"""
import os
from pathlib import Path

# repo root = backend/app/config.py -> parents[2]
_ROOT = Path(__file__).resolve().parents[2]


def _load_root_env() -> None:
    env_file = _ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        # setdefault: never clobber a real env var already set by the shell.
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_root_env()

# BEACON_PORT is what the desktop (Tauri) shell injects — it wins over the
# generic BACKEND_PORT so a dynamic free port picked at launch takes effect.
BACKEND_PORT = int(os.getenv("BEACON_PORT", os.getenv("BACKEND_PORT", "8000")))
FRONTEND_PORT = int(os.getenv("FRONTEND_PORT", "5173"))
DOCS_PORT = int(os.getenv("DOCS_PORT", "5174"))


def cors_origins() -> list[str]:
    """Allowed browser origins — the frontend port is read from the same .env."""
    return [
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
        "http://localhost",
        "http://127.0.0.1",
        "tauri://localhost",
        "http://tauri.localhost",
        "null",
    ]
