"""Recursive Beacon variable and dynamic-value resolution."""
from __future__ import annotations

import random
import re
import string
import time
import uuid
from typing import Any, Mapping


class TemplateResolver:
    def __init__(self, variables: Mapping[str, Any]):
        self.variables = variables

    def resolve(self, value: Any) -> Any:
        if isinstance(value, str):
            for key, replacement in self.variables.items():
                value = value.replace(f"{{{{{key}}}}}", str(replacement))
            return re.sub(r"\{\{([^}]+)\}\}", lambda match: self.generate(match.group(1).strip()), value)
        if isinstance(value, dict):
            if value.get("__file__"):
                return value
            return {key: self.resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.resolve(item) for item in value]
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
