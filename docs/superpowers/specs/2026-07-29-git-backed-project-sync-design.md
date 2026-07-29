# Git-Backed Project Sync Design

**Status:** Implemented through repository import, native Git operations, and branch workflows

**Date:** 2026-07-29

**Target:** Current FastAPI + React/Tauri desktop application

**Document type:** Technical design and product behavior reference
**Audience:** Beacon maintainers and contributors

## Summary

Beacon will allow one project to be linked to a local folder. Once linked, the project source is stored as readable YAML files that can be reviewed, edited, branched, and synchronized with any ordinary Git client.

Beacon does not require a GitHub account or OAuth for this feature. GitHub, GitLab, Bitbucket, Gitea, a local repository, and a plain folder all use the same filesystem contract. Beacon provides constrained Git actions while authentication remains the responsibility of the user's existing SSH keys or system credential helper.

The product goals are:

1. Make API test definitions reviewable beside application source code.
2. Let teams collaborate asynchronously without a Beacon cloud account or an active LAN host.
3. Keep credentials and runtime values outside version control by default.
4. Preserve stable project, folder, endpoint, environment, assertion, and extractor identities.
5. Establish a file contract that a future Beacon CLI and CI runner can execute directly.

## Product Principles

### The folder is the source of truth

After a project is linked, the linked folder is the canonical source definition. Beacon's internal `tests.json` remains a cache and workspace index so startup and existing APIs stay fast.

Changes made in Beacon are written to the linked folder atomically. Changes made by an editor or Git operation are detected before Beacon overwrites them. The user must reload or resolve the difference first.

### Git is optional

Beacon understands files, not a specific hosting provider. A linked folder may be:

- Inside an existing application repository.
- A standalone Git repository.
- Managed with GitHub Desktop, a terminal, an IDE, or another Git client.
- A plain local folder with no `.git` directory.

### Project sync and LAN sharing solve different problems

- Git-backed project sync supports asynchronous collaboration, branches, review, and CI.
- Local project sharing supports live collaboration on the same trusted network.

The same project may not host LAN edits while it has unresolved filesystem changes. Later versions may coordinate both revision models explicitly.

### Execution remains local

The linked source includes request definitions and test configuration. Responses, history, generated values, active tokens, cookies, and run metrics remain on the device that executes the request.

## Scope

### Implemented

- Link one Beacon project to an empty local folder.
- Generate a readable multi-file YAML project.
- Keep stable IDs in every serialized resource.
- Write project changes atomically.
- Store private environment values in a local ignored overlay.
- Generate and maintain a minimal `.gitignore` entry.
- Detect externally added, modified, or deleted project files.
- Reload external source changes into the linked Beacon project.
- Unlink without deleting the folder or repository.
- Display folder path, sync state, changed files, and available actions in Project Settings.
- Open an existing Beacon folder as a new project.
- Clone and inspect Beacon and non-Beacon repositories without executing their code.
- Review managed-file diffs and use constrained commit, pull, push, and fetch actions.
- List, create, compare, and switch branches after verifying a clean working tree and matching project ID.

### Still excluded

- GitHub OAuth or any provider account.
- Merge, rebase, stash, force push, or pull-request actions.
- Automatic three-way merge.
- File watching; phase 1 checks on status refresh and explicit user action.
- Legacy Flask application parity.
- Synchronizing run history, responses, logs, charts, or runtime tokens.
- Running project files directly in CI.

## User Experience

### Link a project

Project Settings contains a **Git-backed project files** section.

1. The user selects **Link folder**.
2. The native desktop folder picker opens.
3. Beacon verifies that the target does not already contain `beacon.yaml`.
4. Beacon writes the project files and local secret overlay.
5. The section changes to **Clean** and shows the absolute folder path.

The action is available even when the folder is not a Git repository. The UI explains that the user may commit it with any Git client.

### Review external changes

When files differ from the last Beacon write, the section changes to **External changes** and lists added, modified, and deleted files.

Beacon does not overwrite these files automatically. The user can:

- **Reload from folder** to accept the external version.
- Inspect or resolve changes in their editor or Git client.
- **Unlink** to keep the current in-app copy independent.

### Unlink

Unlinking removes only the association stored in the Beacon workspace. It never deletes linked files, `.git`, branches, commits, or local secret overlays.

## File Contract

### Directory layout

```text
checkout-api/
├── beacon.yaml
├── endpoints/
│   ├── login--3f8a2c.yaml
│   └── get-profile--9d018b.yaml
├── environments/
│   ├── local--178b4a.yaml
│   └── staging--451b9c.yaml
├── .beacon/
│   └── environments.local.yaml
└── .gitignore
```

The `.beacon/` directory is device-local and ignored. Everything else is project source intended for review and version control.

### Manifest

`beacon.yaml` owns project metadata and collection hierarchy:

```yaml
format: beacon.project
version: 1
project:
  id: 5522e81e-0fc8-4888-a34c-f1c998523d15
  name: Checkout API
  current_environment_id: 178b4a53-9ec7-44df-83f2-b97916447082
  environments:
    - environments/local--178b4a.yaml
    - environments/staging--451b9c.yaml
  items:
    - type: folder
      id: f3fb8d91-680f-42ee-a69e-360433b37202
      name: Authentication
      items:
        - type: request
          id: 3f8a2c3d-25c7-48c8-9ff5-29114b30f92a
          file: endpoints/login--3f8a2c.yaml
```

Paths in the manifest are POSIX-style and relative to the linked root. Absolute paths and `..` segments are invalid.

### Endpoint file

Each endpoint file contains the complete executable request definition:

```yaml
id: 3f8a2c3d-25c7-48c8-9ff5-29114b30f92a
name: Login
method: POST
url: /auth/login
target_type: api
headers:
  Content-Type: application/json
payload_type: json
payload:
  email: "{{user_email}}"
  password: "{{user_password}}"
assertions:
  - type: status
    op: eq
    value: 200
extractors:
  access_token: body.access_token
```

The endpoint ID in the hierarchy must equal the ID inside its endpoint file.

### Shared environment file

Environment files are safe to commit. Values likely to contain credentials are represented by their key with a null value:

```yaml
id: 178b4a53-9ec7-44df-83f2-b97916447082
name: Local
base_url: http://localhost:8000
variables:
  locale: id-ID
  access_token: null
  user_password: null
```

Phase 1 classifies names containing `token`, `secret`, `password`, `authorization`, `cookie`, `api_key`, `apikey`, `private_key`, or `credential` as private.

### Local environment overlay

`.beacon/environments.local.yaml` contains values for private keys and may contain device-specific overrides:

```yaml
version: 1
environments:
  178b4a53-9ec7-44df-83f2-b97916447082:
    access_token: actual-local-token
    user_password: actual-local-password
```

Beacon must ensure `.beacon/` is ignored before writing this file. If it cannot verify or update `.gitignore`, linking fails closed before any secret is written.

## Persistence Model

The internal project record gains local-only metadata:

```json
{
  "file_sync": {
    "path": "/absolute/path/to/checkout-api",
    "schema_version": 1,
    "last_synced_hash": "sha256:...",
    "file_hashes": {
      "beacon.yaml": "sha256:..."
    },
    "last_synced_at": "2026-07-29T08:00:00Z",
    "last_error": null
  }
}
```

This metadata never appears in `beacon.yaml`. Moving the folder causes a disconnected state until the user relinks it.

## Write and Reload Behavior

### Atomic writes

Beacon serializes the complete project into a temporary sibling directory, flushes each file, then replaces managed files. Files outside Beacon's managed paths are never removed.

Before writing, Beacon compares the current managed-file hashes with `file_hashes`. If they differ, the write stops and reports external changes.

### Reload

Reload performs these steps:

1. Parse `beacon.yaml` with safe YAML loading.
2. Reject unsupported format or schema versions.
3. Resolve and validate every relative resource path.
4. Parse all endpoint and environment files.
5. Validate stable IDs and collection hierarchy.
6. Merge `.beacon/environments.local.yaml` values by environment ID.
7. Replace the linked project's source while preserving `file_sync` metadata.
8. Persist the internal cache and new file hashes atomically.

If any step fails, the existing in-memory project remains unchanged.

## Sync States

- **Unlinked:** no folder association.
- **Clean:** managed files match the last synchronized snapshot.
- **External changes:** one or more managed files were added, modified, or deleted.
- **Missing folder:** the linked root or manifest cannot be found.
- **Invalid source:** YAML or schema validation failed.
- **Write error:** Beacon could not write or replace a managed file.

Phase 1 does not claim Git branch, ahead/behind, or merge-conflict awareness. Those are Git integration states for a later phase.

## Security Boundaries

- Folder selection is native desktop functionality and is not exposed to hosted web builds.
- Every manifest path is resolved beneath the linked root.
- Symlinks that escape the linked root are rejected during reload.
- YAML uses safe loading only.
- Unknown schema fields may be preserved later but are rejected where they affect execution in phase 1.
- Private values are written only after `.beacon/` is confirmed ignored.
- Unlink and reload never delete arbitrary user files.
- Git commands never receive credentials in phase 1 because Beacon does not execute Git commands.

## Relationship to Local Project Sharing

A linked project can still be executed normally and may later be shared over LAN. However, Beacon must block a source write or LAN mutation while external file changes are unresolved. This prevents the filesystem and LAN host from independently becoming authoritative.

Phase 1 surfaces the state but does not add cross-system merge behavior.

## Architecture

### Backend

`ProjectFileSyncService` owns serialization, path validation, hashing, atomic writes, reload, and unlink behavior. `Store.save()` asks the service to synchronize linked projects before persisting the internal cache.

The projects router exposes project-scoped orchestration endpoints and translates domain errors into HTTP responses. It does not read or write project files directly.

### Desktop shell

Tauri provides the native directory picker. The selected absolute path is sent to the loopback FastAPI backend. The shell does not parse Beacon project files.

### Frontend

Project Settings displays status and invokes link, refresh, reload, and unlink operations. It does not infer filesystem state locally.

## API Contract

```text
GET    /projects/{project_id}/file-sync
POST   /projects/{project_id}/file-sync/link
POST   /projects/{project_id}/file-sync/reload
DELETE /projects/{project_id}/file-sync
```

Link request:

```json
{ "path": "/absolute/path/to/checkout-api" }
```

Status response:

```json
{
  "linked": true,
  "path": "/absolute/path/to/checkout-api",
  "state": "external_changes",
  "last_synced_at": "2026-07-29T08:00:00Z",
  "changes": [
    { "path": "endpoints/login--3f8a2c.yaml", "kind": "modified" }
  ],
  "message": "1 project file changed outside Beacon"
}
```

## Implementation Phases

### Phase 1: Filesystem foundation

- File contract and serializer.
- Secret classification and ignored local overlay.
- Link, status, reload, and unlink API.
- Native folder picker.
- Project Settings status UI.
- Unit and route tests.

### Phase 2: Existing folder and continuous awareness

- Open an existing Beacon project as a new workspace project.
- Filesystem watcher with debounce.
- Non-destructive diff preview.
- Safer coordination with LAN project sharing.

### Phase 3: Native Git operations

Core phase implemented: repository status, initialize, origin configuration, Beacon-scoped commit, working-tree and last-commit diff preview, fast-forward-only pull, and non-force push. Branch management remains future work.

- Detect repository, branch, clean/dirty, ahead/behind, and conflicts.
- Stage and commit selected Beacon files.
- Pull and push using existing local Git credentials.
- Branch creation and switching.
- No provider OAuth requirement.

### Phase 4: CI and provider integrations

- Headless Beacon runner for linked folders.
- Example GitHub Actions and GitLab CI workflows.
- Optional GitHub/GitLab OAuth for repository discovery and pull requests.

## Verification Strategy

### Automated

- Round-trip nested folders and endpoint features.
- Deterministic filenames and YAML output.
- Private values appear only in the ignored local overlay.
- Atomic write failure leaves the previous source readable.
- Added, modified, and deleted files are detected.
- Path traversal and escaping symlinks are rejected.
- Invalid YAML does not mutate the project.
- Reload merges local private overlays.
- Unlink retains every file.
- Frontend keeps destructive actions explicit and reports all states.

### Manual

- Link a project on macOS, Windows, and Linux.
- Commit the generated folder with an external Git client.
- Edit an endpoint in VS Code and reload it in Beacon.
- Pull a teammate's change and confirm Beacon detects it.
- Confirm tokens do not appear in `git diff`.
- Move or remove the folder and verify recovery guidance.

## Phase 1 Acceptance Criteria

- A user can link an existing Beacon project to an empty folder without an account.
- The generated source is readable YAML and preserves executable project behavior.
- Editing a linked project in Beacon updates managed files unless external changes are pending.
- External changes are never silently overwritten.
- Reloading valid external changes updates the project without losing private local values.
- Secret-like values do not appear in commit-safe files.
- Unlinking leaves the linked folder untouched.
- Existing unlinked projects behave exactly as before.

## Deferred Decisions

- Whether endpoint filenames should remain ID-suffixed or use a separate stable path registry.
- Whether non-secret variable values should always be shared or require explicit scope metadata.
- Whether phase 2 should support JSON alongside YAML.
- Whether Git conflict resolution belongs inside Beacon or should open the user's configured Git client.
- Whether one linked project may be mounted in more than one Beacon workspace on the same device.
