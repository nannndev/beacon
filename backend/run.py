"""PyInstaller entry point for the packaged desktop backend.

`app/main.py` uses package-relative imports (`from . import ...`), which fail
when PyInstaller runs a module directly as a top-level script. This launcher
sits at the backend root and imports the app via absolute package imports
instead, then starts uvicorn. Ports/paths come from the BEACON_* env vars the
Tauri shell injects (see app/config.py).
"""
import sys

from app.core.scripting import maybe_run_worker

# Pre-request scripts run in child processes that re-launch this executable.
maybe_run_worker(sys.argv)

import uvicorn

from app import config as app_config
from app.main import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=app_config.BACKEND_PORT,
        log_level="info",
    )
