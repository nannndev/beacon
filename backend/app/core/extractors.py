"""Response-to-variable extraction for chained API workflows."""
from __future__ import annotations

import re
from typing import Callable, Dict

from .models import EndpointTest


class ResponseExtractor:
    def apply(self, endpoint: EndpointTest, response, variables: Dict,
              log: Callable[[str], None]) -> list[str]:
        try:
            body = response.json() if "application/json" in response.headers.get("content-type", "") else {}
        except Exception:
            body = {}
        changed = []
        for variable_name, source in endpoint.extractors.items():
            value = self._read(body, response, variable_name, source)
            if value is None:
                continue
            serialized = str(value)
            if variables.get(variable_name) != serialized:
                changed.append(variable_name)
            variables[variable_name] = serialized
            log(f"[extract] {variable_name} updated from response")
        return changed

    @staticmethod
    def _read(body, response, variable_name: str, source: str):
        lowered = source.lower()
        if lowered.startswith("body."):
            current = body
            for key in source[5:].split("."):
                if isinstance(current, dict) and key in current:
                    current = current[key]
                elif isinstance(current, list) and key.lstrip("-").isdigit() and -len(current) <= int(key) < len(current):
                    current = current[int(key)]
                else:
                    return None
            return current
        if "set-cookie" in lowered or "cookie" in lowered:
            cookie = response.headers.get("Set-Cookie", "")
            match = re.search(rf"{re.escape(variable_name)}=([^;]+)", cookie, re.IGNORECASE)
            return match.group(1) if match else None
        return None
