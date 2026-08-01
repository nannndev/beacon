"""Recursive Beacon variable and dynamic-value resolution."""
from __future__ import annotations

import contextlib
import random
import re
import string
import threading
import time
import uuid
from typing import Any, Mapping, Optional


class TemplateResolver:
    def __init__(self, variables: Mapping[str, Any], lock: Optional[Any] = None):
        self.variables = variables
        # `variables` is the live config dict that extractors mutate from other
        # threads. Callers that share it across a run pass the config's lock so
        # a concurrent write cannot resize the mapping mid-iteration.
        self._lock = lock or contextlib.nullcontext()

    def _variables_snapshot(self) -> dict:
        with self._lock:
            return dict(self.variables)

    def resolve(self, value: Any) -> Any:
        """Resolve one request's templates against a single consistent view of
        the variables, so every field of a payload sees the same token."""
        return self._resolve(value, self._variables_snapshot())

    def _resolve(self, value: Any, variables: dict) -> Any:
        if isinstance(value, str):
            for key, replacement in variables.items():
                value = value.replace(f"{{{{{key}}}}}", str(replacement))
            return re.sub(r"\{\{([^}]+)\}\}", lambda match: self.generate(match.group(1).strip()), value)
        if isinstance(value, dict):
            if value.get("__file__"):
                return value
            return {key: self._resolve(item, variables) for key, item in value.items()}
        if isinstance(value, list):
            return [self._resolve(item, variables) for item in value]
        return value

    @staticmethod
    def generate(spec: str) -> str:
        normalized = spec.lower().strip()
        if normalized == "random_email": return f"test{random.randint(100000, 9999999)}@mail.test"
        if normalized == "random_phone": return "+62812" + "".join(str(random.randint(0, 9)) for _ in range(8))
        if normalized in {"random_uuid", "uuid"}: return str(uuid.uuid4())
        if normalized == "timestamp": return str(int(time.time() * 1000))
        if normalized == "random_string": return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(8))
        if normalized in {"random_number", "random_int"}: return str(random.randint(100000, 999999))
        if normalized.startswith("random_int:"):
            try:
                _, minimum, maximum = normalized.split(":", 2)
                return str(random.randint(int(minimum), int(maximum)))
            except (TypeError, ValueError):
                return str(random.randint(1000, 9999))
        if normalized.startswith("random_string:"):
            try:
                length = max(1, int(normalized.split(":", 1)[1]))
                return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(length))
            except (TypeError, ValueError):
                return "rnd" + str(random.randint(100, 999))
        return "{{" + normalized + "}}"
