import asyncio
import os
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config as app_config
from .state import store
from .routers import config, projects, environments, tests, runs, history, sharing


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Capture the running loop so worker threads can dispatch WS sends safely.
    store.main_loop = asyncio.get_running_loop()
    store.load()
    store.history.initialize()
    store.history.mark_interrupted_runs()
    store.sharing.initialize()
    yield


app = FastAPI(title="Security Tools API", lifespan=lifespan)


@app.get("/system/info")
def system_info():
    return {
        "app_version": os.getenv("BEACON_APP_VERSION", "dev"),
        "api_protocol": 2,
        "capabilities": ["scenario.start", "sharing.v1", "sharing.protocol.2", "history.v1", "mcp.v1", "project.import.preview", "project.file-sync.v1", "project.file-sync.import.v1", "project.repository.inspect.v1", "project.git.v1", "project.git.diff.v1", "project.git.branches.v1", "project.git.compare.v1"],
    }

# CORS for the React dev server (the app also uses a Vite proxy in dev).
app.add_middleware(
    CORSMiddleware,
    allow_origins=app_config.cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (config, projects, environments, tests, runs, history, sharing):
    app.include_router(module.router)


if __name__ == "__main__":
    port = app_config.BACKEND_PORT
    print("\033[94m[BACKEND]\033[0m \033[1mStarting FastAPI + Uvicorn...\033[0m")
    print(f"\033[94m[BACKEND]\033[0m → http://localhost:{port}")
    print(f"\033[94m[BACKEND]\033[0m Docs → http://localhost:{port}/docs")

    is_frozen = getattr(sys, "frozen", False)
    # Frozen = packaged desktop sidecar: bind loopback only (not 0.0.0.0) so the
    # local backend isn't exposed on the network.
    host = "127.0.0.1" if is_frozen else "0.0.0.0"
    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=not is_frozen,
        log_level="info",
        use_colors=True,
    )
