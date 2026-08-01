"""Authorization resolution for endpoints, folders, and projects.

Auth is stored as a small structured spec rather than a pre-built header
string, because two things need it that a string cannot express:

* **Basic** must be base64-encoded at request time, *after* templating, so
  credentials can come from environment variables instead of being embedded.
* **Inheritance** needs a distinguishable "inherit" state so an endpoint can
  defer to its folder, and a folder to its project.

`resolve_auth_headers` turns a concrete spec into headers. `effective_auth`
walks a project → folder → endpoint chain and returns the spec that actually
applies.
"""
from __future__ import annotations

import base64
from typing import Any, Callable, Dict, Optional

# An endpoint with no `auth` key predates this feature. Those endpoints carry
# their Authorization in `headers`, so the default must send nothing extra.
INHERIT = "inherit"
NONE = "none"

_VALID_TYPES = {INHERIT, NONE, "bearer", "basic", "apikey", "custom"}


def normalize_auth(auth: Any) -> Optional[Dict]:
    """Coerce stored auth into a known shape, or None when unset."""
    if not isinstance(auth, dict):
        return None
    kind = str(auth.get("type") or "").strip().lower()
    if kind not in _VALID_TYPES:
        return None
    return {**auth, "type": kind}


def effective_auth(*chain: Any) -> Optional[Dict]:
    """Resolve an inheritance chain, outermost first.

    Pass project auth, then each enclosing folder, then the endpoint. The most
    specific concrete spec wins; `inherit` defers outward; an explicit `none`
    stops inheritance so an endpoint can opt out of its folder's auth.
    """
    resolved = None
    for level in chain:
        normalized = normalize_auth(level)
        if normalized is None or normalized["type"] == INHERIT:
            continue
        resolved = normalized
    return resolved


def resolve_auth_headers(auth: Any, resolve: Callable[[Any], Any]) -> Dict[str, str]:
    """Build the headers for a concrete auth spec.

    `resolve` applies Beacon templating, so every credential field may be a
    `{{variable}}`. Returns an empty dict for none/inherit/unset.
    """
    normalized = normalize_auth(auth)
    if normalized is None or normalized["type"] in {NONE, INHERIT}:
        return {}

    kind = normalized["type"]

    def value_of(*keys: str, default: str = "") -> str:
        for key in keys:
            if normalized.get(key) not in (None, ""):
                return str(resolve(normalized[key]))
        return default

    if kind == "bearer":
        token = value_of("token", "value")
        # A token that is still an unresolved placeholder would send the literal
        # "Bearer {{access_token}}", which reads as a live credential in logs.
        return {"Authorization": f"Bearer {token}"} if token else {}

    if kind == "basic":
        username = value_of("username", "user")
        password = value_of("password", "pass")
        if not username and not password:
            return {}
        encoded = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        return {"Authorization": f"Basic {encoded}"}

    if kind == "apikey":
        header_name = value_of("key", "header", default="X-API-Key")
        api_value = value_of("value", "token")
        placement = str(normalized.get("in") or "header").lower()
        if placement != "header" or not header_name:
            # Query-parameter keys belong in the URL the user already authored.
            return {}
        return {header_name: api_value}

    if kind == "custom":
        header_name = value_of("header", "key", default="Authorization")
        return {header_name: value_of("value", "token")} if header_name else {}

    return {}
