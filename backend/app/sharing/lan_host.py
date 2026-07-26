import secrets
import socket
import threading
import time
import uuid
from typing import Callable, Optional

import uvicorn
from fastapi import FastAPI, Header, HTTPException


PAIRING_TTL_SECONDS = 300


def local_ip_address() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"
    finally:
        sock.close()


class LanHostService:
    """Restricted, project-scoped LAN server used by the debug MVP.

    It intentionally exposes no ordinary Beacon backend routes. Release builds
    must keep this disabled until TLS fingerprint pairing is implemented.
    """

    def __init__(
        self,
        snapshot: Callable[[str], Optional[dict]],
        revisions: Callable[[str, int], list[dict]],
        mutate: Callable[[dict, str], object],
        device_id: Callable[[], str],
    ):
        self._snapshot = snapshot
        self._revisions = revisions
        self._mutate = mutate
        self._device_id = device_id
        self._server: Optional[uvicorn.Server] = None
        self._thread: Optional[threading.Thread] = None
        self._project_id: Optional[str] = None
        self._project_name: Optional[str] = None
        self._port: Optional[int] = None
        self._pairing_code: Optional[str] = None
        self._pairing_expires_at: float = 0
        self._sessions: dict[str, dict] = {}
        self._pending: dict[str, dict] = {}

    def _app(self) -> FastAPI:
        app = FastAPI(title="Beacon local project host", docs_url=None, redoc_url=None, openapi_url=None)

        @app.get("/beacon-share/info")
        def info():
            return self.status()

        @app.post("/beacon-share/pair")
        def pair(data: dict):
            if data.get("project_id") != self._project_id:
                raise HTTPException(status_code=404, detail="Shared project not found")
            if not self._pairing_code or time.time() >= self._pairing_expires_at:
                raise HTTPException(status_code=410, detail="Pairing code expired")
            if not secrets.compare_digest(str(data.get("code", "")), self._pairing_code):
                raise HTTPException(status_code=403, detail="Invalid pairing code")
            request_id = str(uuid.uuid4())
            self._pending[request_id] = {
                "device_id": str(data.get("device_id") or "unknown"),
                "device_name": str(data.get("device_name") or "Beacon device")[:80],
                "created_at": time.time(),
                "status": "pending",
                "role": None,
            }
            return {"request_id": request_id, "status": "pending", "project_name": self._project_name}

        @app.get("/beacon-share/pair/{request_id}")
        def pairing_status(request_id: str):
            request = self._pending.get(request_id)
            if not request:
                raise HTTPException(status_code=404, detail="Pairing request not found")
            if request["status"] != "approved":
                return {"status": request["status"]}
            return {
                "status": "approved",
                "session_token": request["session_token"],
                "role": request["role"],
                "host_device_id": self._device_id(),
                "snapshot": self._snapshot(self._project_id),
            }

        def session(authorization: Optional[str]) -> dict:
            token = (authorization or "").removeprefix("Bearer ").strip()
            member = self._sessions.get(token)
            if not member:
                raise HTTPException(status_code=401, detail="Invalid sharing session")
            return member

        @app.get("/beacon-share/projects/{project_id}/snapshot")
        def project_snapshot(project_id: str, authorization: Optional[str] = Header(None)):
            session(authorization)
            if project_id != self._project_id:
                raise HTTPException(status_code=404, detail="Shared project not found")
            return self._snapshot(project_id)

        @app.get("/beacon-share/projects/{project_id}/revisions")
        def revisions(project_id: str, after: int = 0, authorization: Optional[str] = Header(None)):
            session(authorization)
            if project_id != self._project_id:
                raise HTTPException(status_code=404, detail="Shared project not found")
            return {"items": self._revisions(project_id, after)}

        @app.post("/beacon-share/projects/{project_id}/mutations")
        def mutation(project_id: str, data: dict, authorization: Optional[str] = Header(None)):
            member = session(authorization)
            if member["role"] != "editor":
                raise HTTPException(status_code=403, detail="Viewer role cannot edit shared source")
            if project_id != self._project_id:
                raise HTTPException(status_code=404, detail="Shared project not found")
            revision = self._mutate({**data, "project_id": project_id}, member["device_id"])
            return revision.__dict__

        return app

    def start(self, project_id: str, project_name: str) -> dict:
        if self._server:
            if self._project_id != project_id:
                raise RuntimeError("Another project is already hosted by this Beacon instance")
            return self.refresh_pairing_code()
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.bind(("0.0.0.0", 0))
        port = probe.getsockname()[1]
        probe.close()
        self._project_id = project_id
        self._project_name = project_name
        self._port = port
        self._pairing_code = f"{secrets.randbelow(1_000_000):06d}"
        self._pairing_expires_at = time.time() + PAIRING_TTL_SECONDS
        config = uvicorn.Config(self._app(), host="0.0.0.0", port=port, log_level="warning")
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, daemon=True, name="beacon-lan-host")
        self._thread.start()
        return self.status()

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self._server = None
        self._thread = None
        self._project_id = None
        self._project_name = None
        self._port = None
        self._pairing_code = None
        self._pairing_expires_at = 0
        self._sessions.clear()
        self._pending.clear()

    def refresh_pairing_code(self) -> dict:
        if not self._server:
            raise RuntimeError("LAN host is not running")
        self._pairing_code = f"{secrets.randbelow(1_000_000):06d}"
        self._pairing_expires_at = time.time() + PAIRING_TTL_SECONDS
        return self.status()

    def status(self) -> dict:
        address = f"{local_ip_address()}:{self._port}" if self._port else None
        return {
            "hosting": self._server is not None,
            "project_id": self._project_id,
            "project_name": self._project_name,
            "host_device_name": socket.gethostname(),
            "address": address,
            "pairing_code": self._pairing_code,
            "pairing_expires_at": self._pairing_expires_at or None,
            "connected_members": list(self._sessions.values()),
            "pending_requests": [
                {"request_id": request_id, **request}
                for request_id, request in self._pending.items()
                if request["status"] == "pending"
            ],
            "transport": "insecure-debug-http" if self._server else None,
        }

    def decide_pairing(self, request_id: str, approved: bool, role: str = "viewer") -> dict:
        request = self._pending.get(request_id)
        if not request:
            raise KeyError("Pairing request not found")
        if role not in {"viewer", "editor"}:
            raise ValueError("Role must be viewer or editor")
        if not approved:
            request["status"] = "rejected"
            return {"request_id": request_id, "status": "rejected"}
        token = secrets.token_urlsafe(32)
        request.update({"status": "approved", "role": role, "session_token": token})
        self._sessions[token] = {
            "device_id": request["device_id"],
            "device_name": request["device_name"],
            "created_at": request["created_at"],
            "role": role,
        }
        return {"request_id": request_id, "status": "approved", "role": role}
