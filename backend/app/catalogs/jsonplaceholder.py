"""Deterministic, safe-to-run JSONPlaceholder sample project."""

import uuid
from copy import deepcopy


JSONPLACEHOLDER_TEMPLATE_ID = "jsonplaceholder-v1"
CATALOG_NAMESPACE = uuid.UUID("4f8ce3fd-56d2-51d1-91fb-ececbcfb260a")
BASE_URL = "https://jsonplaceholder.typicode.com"
SAFE_RUN_CONFIG = {
    "concurrency": 1,
    "max_requests": 10,
    "delay": 0.5,
    "use_min_delay": False,
}

RESOURCE_SPECS = {
    "Posts": (
        "posts",
        "post_id",
        "/posts?userId={{user_id}}",
        {"title": "Beacon sample post", "body": "Created from Beacon", "userId": 1},
    ),
    "Comments": (
        "comments",
        "comment_id",
        "/comments?postId={{post_id}}",
        {"name": "Beacon comment", "email": "demo@example.com", "body": "Sample", "postId": 1},
    ),
    "Albums": (
        "albums",
        "album_id",
        "/albums?userId={{user_id}}",
        {"title": "Beacon sample album", "userId": 1},
    ),
    "Photos": (
        "photos",
        "photo_id",
        "/photos?albumId={{album_id}}",
        {
            "title": "Beacon sample photo",
            "url": "https://example.com/photo.png",
            "thumbnailUrl": "https://example.com/thumb.png",
            "albumId": 1,
        },
    ),
    "Todos": (
        "todos",
        "todo_id",
        "/todos?userId={{user_id}}&completed={{completed}}",
        {"title": "Verify Beacon sample", "completed": False, "userId": 1},
    ),
    "Users": (
        "users",
        "user_id",
        "/users?username={{username}}",
        {"name": "Beacon Demo", "username": "beacon-demo", "email": "demo@example.com"},
    ),
}

RELATIONS = {
    "Posts": [("List post comments", "/posts/{{post_id}}/comments")],
    "Albums": [("List album photos", "/albums/{{album_id}}/photos")],
    "Users": [
        ("List user albums", "/users/{{user_id}}/albums"),
        ("List user todos", "/users/{{user_id}}/todos"),
        ("List user posts", "/users/{{user_id}}/posts"),
    ],
}

VARIABLES = {
    "post_id": 1,
    "comment_id": 1,
    "album_id": 1,
    "photo_id": 1,
    "todo_id": 1,
    "user_id": 1,
    "username": "Bret",
    "completed": "false",
}


def stable_catalog_id(path: str) -> str:
    """Return a stable UUIDv5 for a catalog logical path."""
    return str(uuid.uuid5(CATALOG_NAMESPACE, f"{JSONPLACEHOLDER_TEMPLATE_ID}:{path}"))


def _assertions(method: str, json_path: str = "body.id") -> list[dict]:
    status = 201 if method == "POST" else 200
    rules = [
        {"type": "status", "op": "eq", "value": status},
        {"type": "time_ms", "op": "lt", "value": 5000},
    ]
    if method != "DELETE":
        rules.extend(
            [
                {
                    "type": "header",
                    "name": "content-type",
                    "op": "contains",
                    "value": "application/json",
                },
                {"type": "jsonpath", "path": json_path, "op": "exists"},
            ]
        )
    return rules


def _request(path: str, name: str, url: str, method: str = "GET", payload=None, list_result=False) -> dict:
    method = method.upper()
    return {
        "id": stable_catalog_id(f"request/{path}"),
        "name": name,
        "type": "request",
        "url": url,
        "method": method,
        "headers": {"Content-Type": "application/json"} if method in {"POST", "PUT", "PATCH"} else {},
        "payload": deepcopy(payload or {}),
        "payload_type": "json",
        "extractors": {},
        "run_config": dict(SAFE_RUN_CONFIG),
        "assertions": _assertions(method, "body.0.id" if list_result else "body.id"),
    }


def _folder(path: str, name: str, items: list[dict]) -> dict:
    return {
        "id": stable_catalog_id(f"folder/{path}"),
        "name": name,
        "type": "folder",
        "items": items,
    }


def _resource_folder(name: str, slug: str, id_variable: str, filter_url: str, payload: dict) -> dict:
    base_path = name.lower()
    detail_url = f"/{slug}/{{{{{id_variable}}}}}"
    read = [
        _request(f"{base_path}/read/list", f"List {slug}", f"/{slug}", list_result=True),
        _request(f"{base_path}/read/detail", f"Get {slug[:-1] if slug.endswith('s') else slug}", detail_url),
        _request(f"{base_path}/read/filter", f"Filter {slug}", filter_url, list_result=True),
    ]
    write = [
        _request(f"{base_path}/write/create", f"Create {slug[:-1] if slug.endswith('s') else slug}", f"/{slug}", "POST", payload),
        _request(f"{base_path}/write/replace", f"Replace {slug[:-1] if slug.endswith('s') else slug}", detail_url, "PUT", payload),
        _request(f"{base_path}/write/update", f"Update {slug[:-1] if slug.endswith('s') else slug}", detail_url, "PATCH", payload),
        _request(f"{base_path}/write/delete", f"Delete {slug[:-1] if slug.endswith('s') else slug}", detail_url, "DELETE"),
    ]
    groups = [
        _folder(f"{base_path}/read", "Read", read),
        _folder(f"{base_path}/write", "Write", write),
    ]
    relations = [
        _request(f"{base_path}/relations/{index}", relation_name, url, list_result=True)
        for index, (relation_name, url) in enumerate(RELATIONS.get(name, []), start=1)
    ]
    if relations:
        groups.append(_folder(f"{base_path}/relations", "Relations", relations))
    return _folder(base_path, name, groups)


def build_jsonplaceholder_project(name: str = "Default Project", project_id: str | None = None) -> dict:
    """Build a fresh project shell around the stable catalog tree."""
    pid = project_id or str(uuid.uuid4())
    environment_id = str(uuid.uuid4())
    return {
        "id": pid,
        "name": name,
        "template_id": JSONPLACEHOLDER_TEMPLATE_ID,
        "environments": [
            {
                "id": environment_id,
                "name": "JSONPlaceholder",
                "base_url": BASE_URL,
                "variables": deepcopy(VARIABLES),
            }
        ],
        "current_environment_id": environment_id,
        "items": [
            _resource_folder(resource_name, *spec)
            for resource_name, spec in RESOURCE_SPECS.items()
        ],
    }
