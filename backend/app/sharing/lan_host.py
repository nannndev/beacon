import secrets
import hashlib
import json
import os
import platform
import socket
import threading
import time
import uuid
from typing import Callable, Optional

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request

from .models import MutationConflict
from .tls import ensure_device_certificate, format_fingerprint


PAIRING_TTL_SECONDS = 300
DEFAULT_SHARE_PORT = 47821
DISCOVERY_PORT = 47820
SHARING_PROTOCOL_VERSION = 2
MIN_SHARING_PROTOCOL_VERSION = 2
SHARING_CAPABILITIES = [
    "live_revision_events", "conflict_resolution", "device_presence",
    "trusted_reconnect", "lan_discovery",
]


def local_client_info() -> dict:
    return {
        "app_version": os.getenv("BEACON_APP_VERSION", "dev"),
        "platform": platform.system().lower(),
        "protocol": SHARING_PROTOCOL_VERSION,
        "min_protocol": MIN_SHARING_PROTOCOL_VERSION,
        "capabilities": SHARING_CAPABILITIES,
    }


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
        mutate: Callable[[dict, object], object],
        device_id: Callable[[], str],
        trust_device: Optional[Callable[[str, dict, str], dict]] = None,
        trusted_device: Optional[Callable[[str, str], Optional[dict]]] = None,
        touch_trusted_device: Optional[Callable[[str, str, Optional[str]], None]] = None,
        tls_directory: Optional[str] = None,
    ):
        self._snapshot = snapshot
        self._revisions = revisions
        self._mutate = mutate
        self._device_id = device_id
        self._trust_device = trust_device
        self._trusted_device = trusted_device
        self._touch_trusted_device = touch_trusted_device
        self._cert_path, self._key_path, self._certificate_fingerprint = ensure_device_certificate(
            tls_directory or os.path.join("config", "sharing-identity")
        )
        self._server: Optional[uvicorn.Server] = None
        self._thread: Optional[threading.Thread] = None
        self._project_id: Optional[str] = None
        self._project_name: Optional[str] = None
        self._port: Optional[int] = None
        self._pairing_code: Optional[str] = None
        self._pairing_expires_at: float = 0
        self._sessions: dict[str, dict] = {}
        self._pending: dict[str, dict] = {}
        self._revision_condition = threading.Condition()
        self._discovery_socket: Optional[socket.socket] = None
        self._discovery_thread: Optional[threading.Thread] = None

    def _app(self) -> FastAPI:
        app = FastAPI(title="Beacon local project host", docs_url=None, redoc_url=None, openapi_url=None)

        @app.get("/beacon-share/info")
        def info():
            return {**self.status(), **local_client_info()}

        @app.post("/beacon-share/pair")
        def pair(data: dict, request: Request):
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
                "device_ip": request.client.host if request.client else "unknown",
                "created_at": time.time(),
                "status": "pending",
                "role": None,
                "app_version": str(data.get("app_version") or "unknown")[:32],
                "platform": str(data.get("platform") or "unknown")[:32],
                "protocol": int(data.get("protocol") or 1),
                "capabilities": [str(item) for item in (data.get("capabilities") or [])][:32],
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
                "trusted_credential": request.get("trusted_credential"),
                "snapshot": self._snapshot(self._project_id),
                **local_client_info(),
            }

        @app.post("/beacon-share/reconnect")
        def reconnect(data: dict, request: Request):
            if data.get("project_id") != self._project_id or not self._trusted_device:
                raise HTTPException(status_code=404, detail="Shared project not found")
            device_id = str(data.get("device_id") or "")
            credential = str(data.get("trusted_credential") or "")
            trusted = self._trusted_device(self._project_id, device_id)
            digest = hashlib.sha256(credential.encode()).hexdigest()
            if not trusted or not secrets.compare_digest(digest, trusted["credential_hash"]):
                raise HTTPException(status_code=401, detail="Trusted device credential is invalid")
            token = secrets.token_urlsafe(32)
            member = {
                "device_id": device_id, "device_name": trusted["device_name"],
                "device_ip": request.client.host if request.client else trusted.get("device_ip"),
                "created_at": time.time(), "last_seen": time.time(),
                "connection_state": "online", "role": trusted["role"],
                "app_version": str(data.get("app_version") or trusted.get("app_version") or "unknown"),
                "platform": str(data.get("platform") or trusted.get("platform") or "unknown"),
                "protocol": int(data.get("protocol") or trusted.get("protocol") or 1),
                "capabilities": [str(item) for item in (data.get("capabilities") or [])][:32],
            }
            self._sessions[token] = member
            if self._touch_trusted_device:
                self._touch_trusted_device(self._project_id, device_id, member.get("device_ip"))
            return {"session_token": token, "role": member["role"], "snapshot": self._snapshot(self._project_id), **local_client_info()}

        def session(authorization: Optional[str]) -> dict:
            token = (authorization or "").removeprefix("Bearer ").strip()
            member = self._sessions.get(token)
            if not member:
                raise HTTPException(status_code=401, detail="Invalid sharing session")
            member["last_seen"] = time.time()
            member["connection_state"] = "online"
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

        @app.get("/beacon-share/projects/{project_id}/events")
        def events(
            project_id: str, after: int = 0, timeout: float = 5,
            active_target_id: Optional[str] = None, active_target_name: Optional[str] = None,
            activity: Optional[str] = None, authorization: Optional[str] = Header(None),
        ):
            member = session(authorization)
            if project_id != self._project_id:
                raise HTTPException(status_code=404, detail="Shared project not found")
            timeout = max(0.1, min(float(timeout), 10.0))
            member.update({
                "active_target_id": active_target_id,
                "active_target_name": (active_target_name or "")[:120] or None,
                "activity": activity if activity in {"viewing", "editing"} else None,
            })
            deadline = time.monotonic() + timeout
            while True:
                items = self._revisions(project_id, after)
                if items:
                    member["last_seen"] = time.time()
                    return {"items": items, "timed_out": False}
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    member["last_seen"] = time.time()
                    return {"items": [], "timed_out": True}
                with self._revision_condition:
                    self._revision_condition.wait(timeout=remaining)

        @app.post("/beacon-share/projects/{project_id}/mutations")
        def mutation(project_id: str, data: dict, authorization: Optional[str] = Header(None)):
            member = session(authorization)
            if member["role"] != "editor":
                raise HTTPException(status_code=403, detail="Viewer role cannot edit shared source")
            if project_id != self._project_id:
                raise HTTPException(status_code=404, detail="Shared project not found")
            try:
                revision = self._mutate({**data, "project_id": project_id}, member)
            except MutationConflict as conflict:
                raise HTTPException(status_code=409, detail=conflict.to_dict())
            with self._revision_condition:
                self._revision_condition.notify_all()
            return revision.__dict__

        return app

    def start(self, project_id: str, project_name: str) -> dict:
        if self._server:
            if self._project_id != project_id:
                raise RuntimeError("Another project is already hosted by this Beacon instance")
            return self.refresh_pairing_code()
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        preferred_port = int(os.getenv("BEACON_SHARE_PORT", str(DEFAULT_SHARE_PORT)))
        try:
            probe.bind(("0.0.0.0", preferred_port))
        except OSError:
            probe.bind(("0.0.0.0", 0))
        port = probe.getsockname()[1]
        probe.close()
        self._project_id = project_id
        self._project_name = project_name
        self._port = port
        self._pairing_code = f"{secrets.randbelow(1_000_000):06d}"
        self._pairing_expires_at = time.time() + PAIRING_TTL_SECONDS
        config = uvicorn.Config(
            self._app(), host="0.0.0.0", port=port, log_level="warning",
            ssl_certfile=self._cert_path, ssl_keyfile=self._key_path,
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, daemon=True, name="beacon-lan-host")
        self._thread.start()
        self._start_discovery()
        return self.status()

    def _start_discovery(self) -> None:
        if self._discovery_thread and self._discovery_thread.is_alive():
            return
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", DISCOVERY_PORT))
        except OSError:
            sock.close()
            return
        sock.settimeout(0.5)
        self._discovery_socket = sock

        def respond():
            while self._discovery_socket is sock:
                try:
                    payload, sender = sock.recvfrom(4096)
                    message = json.loads(payload.decode("utf-8"))
                    if message.get("type") != "beacon-project-discovery" or message.get("project_id") != self._project_id:
                        continue
                    response = json.dumps({
                        "type": "beacon-project-host", "project_id": self._project_id,
                        "project_name": self._project_name, "host_device_id": self._device_id(),
                        "port": self._port, "certificate_fingerprint": self._certificate_fingerprint,
                    }).encode("utf-8")
                    sock.sendto(response, sender)
                except (socket.timeout, json.JSONDecodeError, UnicodeDecodeError):
                    continue
                except OSError:
                    break

        self._discovery_thread = threading.Thread(target=respond, daemon=True, name="beacon-lan-discovery")
        self._discovery_thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        discovery = self._discovery_socket
        self._discovery_socket = None
        if discovery:
            discovery.close()
        if self._discovery_thread and self._discovery_thread.is_alive():
            self._discovery_thread.join(timeout=1)
        self._discovery_thread = None
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

    def notify_revision(self) -> None:
        with self._revision_condition:
            self._revision_condition.notify_all()

    def status(self) -> dict:
        address = f"{local_ip_address()}:{self._port}" if self._port else None
        now = time.time()
        members = [
            {**member, "connection_state": "online" if now - member.get("last_seen", 0) <= 8 else "offline"}
            for member in self._sessions.values()
        ]
        return {
            "hosting": self._server is not None,
            "project_id": self._project_id,
            "project_name": self._project_name,
            "host_device_name": socket.gethostname(),
            "host_device_id": self._device_id(),
            "host_device_ip": local_ip_address(),
            "certificate_fingerprint": format_fingerprint(self._certificate_fingerprint),
            "address": address,
            "pairing_code": self._pairing_code,
            "pairing_expires_at": self._pairing_expires_at or None,
            "connected_members": members,
            "pending_requests": [
                {"request_id": request_id, **request}
                for request_id, request in self._pending.items()
                if request["status"] == "pending"
            ],
            "transport": "https-pinned" if self._server else None,
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
        trusted_credential = secrets.token_urlsafe(32)
        request["trusted_credential"] = trusted_credential
        self._sessions[token] = {
            "device_id": request["device_id"],
            "device_name": request["device_name"],
            "device_ip": request["device_ip"],
            "created_at": request["created_at"],
            "last_seen": time.time(),
            "connection_state": "online",
            "role": role,
            "app_version": request["app_version"], "platform": request["platform"],
            "protocol": request["protocol"], "capabilities": request["capabilities"],
        }
        if self._trust_device and self._project_id:
            self._trust_device(
                self._project_id, self._sessions[token],
                hashlib.sha256(trusted_credential.encode()).hexdigest(),
            )
        return {"request_id": request_id, "status": "approved", "role": role}

    def update_member(self, device_id: str, role: str) -> dict:
        if role not in {"viewer", "editor"}:
            raise ValueError("Role must be viewer or editor")
        for member in self._sessions.values():
            if member["device_id"] == device_id:
                member["role"] = role
                return {"device_id": device_id, "role": role}
        raise KeyError("Connected member not found")

    def remove_member(self, device_id: str) -> dict:
        tokens = [token for token, member in self._sessions.items() if member["device_id"] == device_id]
        if not tokens:
            raise KeyError("Connected member not found")
        for token in tokens:
            self._sessions.pop(token, None)
        return {"device_id": device_id, "removed": True}
