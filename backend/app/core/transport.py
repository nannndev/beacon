"""Concrete requests transport for Beacon endpoint payload types."""
from __future__ import annotations

import base64
import json

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
