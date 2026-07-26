import copy
import re
from typing import Any


SECRET_KEY = re.compile(
    r"token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key",
    re.IGNORECASE,
)


def is_likely_secret(key: str) -> bool:
    return bool(SECRET_KEY.search(str(key)))


def _variable_entry(key: str, raw: Any) -> dict:
    if isinstance(raw, dict) and raw.get("scope") in {"shared", "private"}:
        scope = raw["scope"]
        value = raw.get("value")
    else:
        scope = "private" if is_likely_secret(key) else "shared"
        value = raw
    return {"key": key, "scope": scope, "value": value if scope == "shared" else None}


def sanitize_project_source(project: dict) -> dict:
    """Return the shareable project source without device-local secret values."""
    source = copy.deepcopy(project)
    # Device-local collaboration/session metadata and notification credentials
    # are never part of the shared project source.
    source.pop("shared_origin", None)
    source.pop("notifications", None)
    for environment in source.get("environments", []):
        variables = environment.get("variables", {})
        if isinstance(variables, dict):
            environment["variables"] = {
                key: _variable_entry(key, value) for key, value in variables.items()
            }
        elif isinstance(variables, list):
            environment["variables"] = {
                str(item.get("key", "")): _variable_entry(str(item.get("key", "")), item)
                for item in variables
                if isinstance(item, dict) and item.get("key")
            }
    return source
