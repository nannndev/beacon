"""GraphQL schema introspection proxy.

Fetches the schema from a target GraphQL endpoint through the Beacon backend,
avoiding CORS issues and providing a simple in-memory cache.
"""
import hashlib
import json
import time

import requests
from fastapi import APIRouter, HTTPException

from ..state import store

router = APIRouter(prefix="/graphql", tags=["graphql"])

INTROSPECTION_QUERY = """
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args {
          name
          description
          type { name kind ofType { name kind } }
        }
        type { name kind ofType { name kind } }
      }
      inputFields {
        name
        description
        type { name kind ofType { name kind } }
      }
      enumValues {
        name
        description
      }
    }
  }
}
"""

CACHE_TTL = 300  # 5 minutes


def _cache_key(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _init_schema_store():
    if not hasattr(store, "graphql_schemas"):
        store.graphql_schemas = {}


@router.post("/introspect")
def introspect_schema(data: dict):
    target_url = str(data.get("target_url", "")).strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="target_url is required")

    headers = data.get("headers") or {}
    if isinstance(headers, dict):
        headers = {str(k): str(v) for k, v in headers.items()}

    _init_schema_store()
    key = _cache_key(target_url)
    cached = store.graphql_schemas.get(key)
    if cached and time.time() < cached.get("expires_at", 0):
        return {
            "ok": True,
            "schema": cached["schema"],
            "hash": cached["hash"],
            "cached": True,
        }

    try:
        resp = requests.post(
            target_url,
            json={"query": INTROSPECTION_QUERY},
            headers={**headers, "Content-Type": "application/json"},
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json()
    except requests.RequestException as e:
        return {"ok": False, "error": f"Could not reach the GraphQL endpoint: {e}"}
    except json.JSONDecodeError:
        return {"ok": False, "error": "The endpoint did not return valid JSON"}

    schema_data = body.get("data", {}).get("__schema")
    if not schema_data:
        errors = body.get("errors", [])
        msg = errors[0].get("message", "Unknown error") if errors else "No schema returned"
        return {"ok": False, "error": msg}

    schema_json = json.dumps(schema_data, sort_keys=True)
    schema_hash = hashlib.sha256(schema_json.encode()).hexdigest()[:12]

    store.graphql_schemas[key] = {
        "schema": schema_data,
        "hash": schema_hash,
        "fetched_at": time.time(),
        "expires_at": time.time() + CACHE_TTL,
    }

    return {"ok": True, "schema": schema_data, "hash": schema_hash, "cached": False}


@router.get("/schema")
def get_cached_schema(url: str = "", hash: str = ""):
    _init_schema_store()
    key = _cache_key(url) if url else ""
    cached = store.graphql_schemas.get(key) if key else None
    if not cached:
        return {"ok": False, "error": "No cached schema for this URL"}
    if time.time() >= cached.get("expires_at", 0):
        return {"ok": False, "error": "Cached schema has expired — re-fetch"}
    return {"ok": True, "schema": cached["schema"], "hash": cached["hash"]}
