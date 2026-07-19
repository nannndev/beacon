# JSONPlaceholder Sample Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed every fresh Beacon workspace with a structured 47-request JSONPlaceholder project and let existing users add the same sample without duplication or overwrite.

**Architecture:** A pure deterministic catalog factory owns the sample tree, variables, assertions, and stable UUIDv5 IDs. Store initialization and an idempotent project API both consume that factory; React exposes the action without matching project display names.

**Tech Stack:** Python 3 standard library, FastAPI, React 18, TypeScript, Vitest, existing JSON project repository.

## Global Constraints

- Fresh means `Repository.load()` returned no persisted collection; never replace an existing empty project.
- The catalog has exactly 47 requests: 36 basic CRUD, 6 filters, and 5 nested routes.
- Default run settings are one worker, 10 requests, and 2 requests per second.
- Project marker is exactly `jsonplaceholder-v1`.
- Project export omits the internal `template_id`; imported samples are normal user projects.
- Folder and request IDs are stable UUIDv5 values derived from the template ID and logical path; project/environment IDs remain workspace-unique UUIDv4 values.
- Do not modify the legacy Flask implementation.

---

## File Structure

- `backend/app/catalogs/__init__.py` — catalog package exports.
- `backend/app/catalogs/jsonplaceholder.py` — pure project/tree factory and stable IDs.
- `backend/tests/helpers.py` — in-memory project repository and tree flattening helpers.
- `backend/tests/test_jsonplaceholder_catalog.py` — catalog contract tests.
- `backend/tests/test_sample_project_flow.py` — fresh-store and idempotent API-service tests.
- `backend/app/state.py` — consume the catalog only when storage is absent.
- `backend/app/routers/projects.py` — project-list marker and sample-project route.
- `frontend/src/types.ts` — optional `template_id` on projects.
- `frontend/src/lib/api.ts` — typed Add Sample Project call.
- `frontend/src/lib/sampleProject.ts` — pure availability/label logic.
- `frontend/src/lib/sampleProject.test.ts` — frontend state tests.
- `frontend/src/components/Sidebar.tsx` — Add Sample Project control.
- `frontend/src/App.tsx` — create/switch/refresh flow.
- `frontend/src/pages/Onboarding.tsx` — explain the ready-to-run sample.
- `frontend/package.json` — Vitest test script and dev dependency.

---

### Task 1: Deterministic JSONPlaceholder Catalog

**Files:**
- Create: `backend/app/catalogs/__init__.py`
- Create: `backend/app/catalogs/jsonplaceholder.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/helpers.py`
- Create: `backend/tests/test_jsonplaceholder_catalog.py`

**Interfaces:**
- Produces: `JSONPLACEHOLDER_TEMPLATE_ID: str`
- Produces: `build_jsonplaceholder_project(name: str = "Default Project", project_id: str | None = None) -> dict`
- Produces: `stable_catalog_id(path: str) -> str`

- [ ] **Step 1: Write the failing catalog tests**

Create the reusable test helper first:

```python
from copy import deepcopy
from backend.app.repository import Repository

class MemoryRepository(Repository):
    def __init__(self, data=None):
        self.data = deepcopy(data)
    def load(self):
        return deepcopy(self.data)
    def save(self, data):
        self.data = deepcopy(data)

def flatten_requests(items):
    result = []
    for item in items or []:
        if item.get("type") == "request":
            result.append(item)
        else:
            result.extend(flatten_requests(item.get("items", [])))
    return result
```

```python
import unittest
from backend.app.catalogs.jsonplaceholder import (
    JSONPLACEHOLDER_TEMPLATE_ID,
    build_jsonplaceholder_project,
)
from backend.tests.helpers import flatten_requests

class JsonPlaceholderCatalogTests(unittest.TestCase):
    def test_catalog_has_47_unique_requests_and_expected_tree(self):
        project = build_jsonplaceholder_project()
        requests = flatten_requests(project["items"])
        self.assertEqual(JSONPLACEHOLDER_TEMPLATE_ID, "jsonplaceholder-v1")
        self.assertEqual(project["template_id"], JSONPLACEHOLDER_TEMPLATE_ID)
        self.assertEqual(len(requests), 47)
        self.assertEqual(len({r["id"] for r in requests}), 47)
        self.assertEqual([f["name"] for f in project["items"]],
                         ["Posts", "Comments", "Albums", "Photos", "Todos", "Users"])

    def test_catalog_ids_are_stable_and_defaults_are_safe(self):
        first = build_jsonplaceholder_project()
        second = build_jsonplaceholder_project()
        self.assertEqual(
            [r["id"] for r in flatten_requests(first["items"])],
            [r["id"] for r in flatten_requests(second["items"])],
        )
        self.assertEqual(first["environments"][0]["base_url"],
                         "https://jsonplaceholder.typicode.com")
        for request in flatten_requests(first["items"]):
            self.assertEqual(request["run_config"], {
                "concurrency": 1, "max_requests": 10,
                "delay": 0.5, "use_min_delay": False,
            })
```

- [ ] **Step 2: Run tests to verify RED**

Run: `python -m unittest backend.tests.test_jsonplaceholder_catalog -v`  
Expected: FAIL with `ModuleNotFoundError: backend.app.catalogs`.

- [ ] **Step 3: Implement the catalog factory**

Use a resource table with exact IDs, filter URLs, representative payloads, and relations:

```python
JSONPLACEHOLDER_TEMPLATE_ID = "jsonplaceholder-v1"
CATALOG_NAMESPACE = uuid.UUID("4f8ce3fd-56d2-51d1-91fb-ececbcfb260a")

RESOURCE_SPECS = {
    "Posts": ("posts", "post_id", "/posts?userId={{user_id}}",
              {"title": "Beacon sample post", "body": "Created from Beacon", "userId": 1}),
    "Comments": ("comments", "comment_id", "/comments?postId={{post_id}}",
                 {"name": "Beacon comment", "email": "demo@example.com", "body": "Sample", "postId": 1}),
    "Albums": ("albums", "album_id", "/albums?userId={{user_id}}",
               {"title": "Beacon sample album", "userId": 1}),
    "Photos": ("photos", "photo_id", "/photos?albumId={{album_id}}",
               {"title": "Beacon sample photo", "url": "https://example.com/photo.png",
                "thumbnailUrl": "https://example.com/thumb.png", "albumId": 1}),
    "Todos": ("todos", "todo_id", "/todos?userId={{user_id}}&completed={{completed}}",
              {"title": "Verify Beacon sample", "completed": False, "userId": 1}),
    "Users": ("users", "user_id", "/users?username={{username}}",
              {"name": "Beacon Demo", "username": "beacon-demo", "email": "demo@example.com"}),
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

def stable_catalog_id(path: str) -> str:
    return str(uuid.uuid5(CATALOG_NAMESPACE, f"{JSONPLACEHOLDER_TEMPLATE_ID}:{path}"))
```

Build `Read`, `Write`, and optional `Relations` folders. Each request must include `type`, URL, method, headers, payload, payload type, assertions, extractors, and the safe `run_config`. Assertions are concrete engine records:

```python
[
    {"type": "status", "op": "eq", "value": 201 if method == "POST" else 200},
    {"type": "time_ms", "op": "lt", "value": 5000},
    {"type": "header", "name": "content-type", "op": "contains", "value": "application/json"},
    {"type": "jsonpath", "path": representative_path, "op": "exists"},
]
```

Omit content-type and JSON-path assertions for DELETE because JSONPlaceholder returns an empty object.

- [ ] **Step 4: Run catalog tests to verify GREEN**

Run: `python -m unittest backend.tests.test_jsonplaceholder_catalog -v`  
Expected: 2 tests pass and the request count is 47.

- [ ] **Step 5: Commit the factory**

```powershell
git add backend/app/catalogs backend/tests
git commit -m "feat: add JSONPlaceholder sample catalog"
```

---

### Task 2: Fresh Seed and Idempotent Project Service

**Files:**
- Modify: `backend/app/state.py`
- Modify: `backend/app/routers/projects.py`
- Create: `backend/tests/test_sample_project_flow.py`

**Interfaces:**
- Consumes: `build_jsonplaceholder_project(name: str) -> dict`
- Produces: `ensure_jsonplaceholder_project(target_store, name="JSONPlaceholder API") -> tuple[dict, bool]`
- Produces: `POST /projects/samples/jsonplaceholder -> {project_id, created}`

- [ ] **Step 1: Write failing fresh/idempotency tests**

```python
class SampleProjectFlowTests(unittest.TestCase):
    def test_missing_storage_seeds_default_sample(self):
        store = Store(MemoryRepository(None))
        store.load()
        self.assertEqual(len(store.projects), 1)
        self.assertEqual(store.projects[0]["name"], "Default Project")
        self.assertEqual(store.projects[0]["template_id"], "jsonplaceholder-v1")

    def test_existing_empty_project_is_not_replaced(self):
        data = {"current_project_id": "p1", "projects": [{
            "id": "p1", "name": "Mine", "environments": [], "items": []
        }], "global_variables": {}}
        store = Store(MemoryRepository(data))
        store.load()
        self.assertNotIn("template_id", store.projects[0])

    def test_ensure_sample_is_idempotent(self):
        data = {"current_project_id": "p1", "projects": [{
            "id": "p1", "name": "Mine", "environments": [], "items": []
        }], "global_variables": {}}
        store = Store(MemoryRepository(data))
        store.load()
        first, created_first = ensure_jsonplaceholder_project(store, "JSONPlaceholder API")
        second, created_second = ensure_jsonplaceholder_project(store, "JSONPlaceholder API")
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(created_first)
        self.assertFalse(created_second)
```

- [ ] **Step 2: Run flow tests to verify RED**

Run: `python -m unittest backend.tests.test_sample_project_flow -v`  
Expected: FAIL because `Store.load()` still creates a blank project and the ensure function is absent.

- [ ] **Step 3: Connect the factory to Store and projects router**

```python
def ensure_jsonplaceholder_project(target_store, name="JSONPlaceholder API"):
    existing = next((p for p in target_store.projects
                     if p.get("template_id") == JSONPLACEHOLDER_TEMPLATE_ID), None)
    if existing:
        return existing, False
    project = build_jsonplaceholder_project(name=name)
    target_store.projects.append(project)
    target_store.current_project_id = project["id"]
    target_store.sync_current_config()
    target_store.save()
    return project, True

@router.post("/projects/samples/jsonplaceholder")
def add_jsonplaceholder_sample():
    project, created = ensure_jsonplaceholder_project(store)
    return {"project_id": project["id"], "created": created}
```

Make `Store._default_project()` call `build_jsonplaceholder_project(project_id=pid)`; the factory always creates a workspace-unique environment ID. Extend `GET /projects` with `template_id`. Omit `template_id` from `export_project()`.

- [ ] **Step 4: Run all backend sample tests**

Run: `python -m unittest discover -s backend/tests -v`  
Expected: catalog and flow suites pass.

- [ ] **Step 5: Commit backend integration**

```powershell
git add backend/app/state.py backend/app/routers/projects.py backend/tests
git commit -m "feat: seed and add sample projects safely"
```

---

### Task 3: Add Sample Project Frontend Flow

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/sampleProject.ts`
- Create: `frontend/src/lib/sampleProject.test.ts`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/Onboarding.tsx`

**Interfaces:**
- Produces: `hasJsonPlaceholderSample(projects: Project[]): boolean`
- Produces: `api.addJsonPlaceholderSample(): Promise<{project_id: string; created: boolean}>`
- Sidebar consumes: `onAddSampleProject`, `sampleProjectExists`, `sampleProjectBusy`

- [ ] **Step 1: Add Vitest and write the failing state test**

Add `"test": "vitest run"` and `vitest` to frontend dev dependencies, then create:

```ts
import { describe, expect, it } from 'vitest'
import { hasJsonPlaceholderSample } from './sampleProject'

describe('hasJsonPlaceholderSample', () => {
  it('uses template_id instead of display name', () => {
    expect(hasJsonPlaceholderSample([{ id: '1', name: 'Renamed', template_id: 'jsonplaceholder-v1' } as any])).toBe(true)
    expect(hasJsonPlaceholderSample([{ id: '2', name: 'JSONPlaceholder API' } as any])).toBe(false)
  })
})
```

- [ ] **Step 2: Run the frontend test to verify RED**

Run: `corepack pnpm@8.15.9 --dir frontend test -- src/lib/sampleProject.test.ts`  
Expected: FAIL because `sampleProject.ts` does not exist.

- [ ] **Step 3: Implement typed API, state helper, and UI action**

```ts
export const JSONPLACEHOLDER_TEMPLATE_ID = 'jsonplaceholder-v1'
export function hasJsonPlaceholderSample(projects: Project[]): boolean {
  return projects.some((project) => project.template_id === JSONPLACEHOLDER_TEMPLATE_ID)
}

// api.ts
addJsonPlaceholderSample: () =>
  req<{ project_id: string; created: boolean }>(
    '/projects/samples/jsonplaceholder', jsonInit('POST'),
  ),
```

Add `template_id?: string` to `Project`. In `App`, call the API, refresh projects/config, switch to the returned project, and show distinct created/existing toasts. Add a secondary **Add Sample Project** button in the expanded Sidebar project section; disable it while busy and relabel it **Sample Project Added** when the marker exists. Update onboarding copy to mention the preloaded JSONPlaceholder workspace.

- [ ] **Step 4: Verify frontend tests and production build**

Run: `corepack pnpm@8.15.9 --dir frontend test`  
Expected: all frontend tests pass.  
Run: `corepack pnpm@8.15.9 --dir frontend build`  
Expected: TypeScript and Vite build exit 0.

- [ ] **Step 5: Commit frontend flow**

```powershell
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src
git commit -m "feat: expose JSONPlaceholder sample project"
```

---

### Task 4: Sample Project Acceptance Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/getting-started.md`

**Interfaces:**
- Consumes all preceding sample-project interfaces.
- Produces user documentation and final verified phase.

- [ ] **Step 1: Run the backend and query the fresh workspace**

Use a temporary data directory so no user config is touched:

```powershell
$env:BEACON_DATA_DIR = Join-Path $env:TEMP 'beacon-sample-acceptance'
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8011
```

In a second terminal, call `/projects` and verify one Default Project, six top-level resource folders, and 47 flattened endpoints. Call `POST /projects/samples/jsonplaceholder` twice and verify both responses point to the same project ID.

- [ ] **Step 2: Document the sample workspace**

Document that fresh installs include JSONPlaceholder CRUD examples, public-API defaults are intentionally conservative, and existing users can use **Add Sample Project**.

- [ ] **Step 3: Run the complete phase gate**

Run: `python -m unittest discover -s backend/tests -v`  
Run: `corepack pnpm@8.15.9 --dir frontend test`  
Run: `corepack pnpm@8.15.9 --dir frontend build`  
Expected: all commands exit 0 and catalog tests report exactly 47 requests.

- [ ] **Step 4: Commit documentation**

```powershell
git add README.md docs/getting-started.md
git commit -m "docs: explain the sample API workspace"
```
