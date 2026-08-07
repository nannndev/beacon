"""Concrete requests transport for Beacon endpoint payload types."""
from __future__ import annotations

import base64
import json
import traceback

import websocket

from .models import EndpointTest


class HttpTransport:
    def send(self, session, endpoint: EndpointTest, url, headers, payload, timeout: int = 10):
        if endpoint.target_type == "web":
            return session.request(endpoint.method, url, headers=headers, timeout=timeout)

        payload_type = (endpoint.payload_type or "json").lower()
        if payload_type == "form":
            return session.request(endpoint.method, url, headers=headers, data=payload, timeout=timeout)
        if payload_type == "multipart":
            files = {}
            for key, value in (payload or {}).items():
                if isinstance(value, dict) and value.get("__file__"):
                    try: content = base64.b64decode(value.get("data", "") or "")
                    except Exception: content = b""
                    files[key] = (value.get("name") or "file", content, value.get("type") or "application/octet-stream")
                else:
                    files[key] = (None, str(value))
            safe_headers = {key: value for key, value in headers.items() if key.lower() != "content-type"}
            return session.request(endpoint.method, url, headers=safe_headers, files=files, timeout=timeout)
        if payload_type == "raw":
            body = payload if isinstance(payload, str) else json.dumps(payload)
            return session.request(endpoint.method, url, headers=headers, data=body.encode("utf-8"), timeout=timeout)
        return session.request(endpoint.method, url, headers=headers, json=payload, timeout=timeout)


class WebSocketTransport:
    def connect(self, url: str, headers: dict, timeout: int = 10):
        ws_url = url if url.startswith(("ws://", "wss://")) else f"ws://{url}"
        ws_headers = [f"{k}: {v}" for k, v in (headers or {}).items()]
        return websocket.create_connection(ws_url, header=ws_headers, timeout=timeout)

    def send_message(self, ws, data: str, msg_type: str = "text"):
        if msg_type == "binary":
            try:
                raw = base64.b64decode(data)
            except Exception:
                raw = data.encode("utf-8") if isinstance(data, str) else data
            ws.send_binary(raw)
        else:
            ws.send(data if isinstance(data, str) else str(data))

    def receive_message(self, ws, timeout: int = 10):
        ws.settimeout(timeout)
        try:
            frame = ws.recv()
            if isinstance(frame, bytes):
                return {"type": "binary", "data": base64.b64encode(frame).decode(), "raw_bytes": len(frame)}
            return {"type": "text", "data": frame}
        except websocket.WebSocketTimeoutException:
            return {"type": "timeout", "data": None}

    def close(self, ws):
        try:
            ws.close()
        except Exception:
            pass
