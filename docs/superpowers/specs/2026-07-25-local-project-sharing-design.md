# Local Project Sharing Design

**Status:** Approved direction; ready for implementation planning
**Date:** 2026-07-25
**Target:** Current FastAPI + React/Tauri desktop application
**Document type:** Technical design and product behavior explanation

## Summary

Beacon will allow a user to share one project with teammates on the same local network. One Beacon desktop instance hosts the shared project source. Other Beacon desktop instances discover or connect to that host, receive a local synchronized copy, and submit project changes back to the host.

The feature is deliberately project-scoped. A user's workspace and unrelated projects remain private. Request execution, responses, run history, load-test metrics, and private environment values remain local to each device.

The product goals are:

1. Let a small team collaborate on the same API project without an account or cloud service.
2. Record every accepted source change as an attributable project revision.
3. Keep request execution and runtime evidence on the device that initiated the run.
4. Prevent credentials and private variables from being shared accidentally.
5. Establish a synchronization contract that can later support a hosted Beacon service without replacing the desktop model.

## Product Principles

### Workspace remains personal

A Beacon workspace is the user's local application context. It contains personal projects, local preferences, run history, and device-specific secrets. Enabling local sharing must never expose the entire workspace.

### Sharing is per project

The owner explicitly enables sharing for one project. Each shared project has an independent host session, membership list, pairing credential, revision stream, and sharing state.

```text
My Workspace
├─ Internal Platform API    shared on local network
├─ Client Sandbox           private
└─ Personal Experiments     private
```

### Source synchronizes; execution does not

Project definitions synchronize across members. Every request is still executed by the member's own device using that device's network access and private variables.

```text
Shared project source
  folders, endpoints, assertions, shared variables
                    ↓ synchronized
Member device
  resolves private variables → sends request → stores local result/history
```

### Host is authoritative in the first release

The host owns the canonical revision stream. Clients may keep a synchronized local copy, but an edit becomes part of the shared project only after the host validates and accepts it.

### Local-first is not offline multi-master

The MVP supports collaboration while the host is reachable. It does not promise that several disconnected members can edit independently and later merge arbitrary histories. A disconnected client may view its last synchronized copy, but shared editing is disabled until the host reconnects.

## Scope

### Included in the MVP

- Enable or disable local-network sharing for one project.
- Automatic local discovery where supported, plus manual host-address entry.
- Short-lived pairing codes and explicit host approval for a new device.
- Owner, editor, and viewer roles.
- Initial project snapshot transfer.
- Synchronization of folders, endpoints, project metadata, assertions, extractors, test-mode defaults, and explicitly shared environment data.
- Monotonic project revisions.
- Attributed change history.
- Optimistic concurrency checks and safe conflict responses.
- Reconnection from the last acknowledged revision.
- Local execution on every member device.
- Clear connection, synchronization, conflict, and host-offline states.

### Excluded from the MVP

- Sharing an entire workspace.
- User accounts, cloud hosting, internet relay, or remote access outside the local network.
- Real-time cursor presence, collaborative text editing, comments, or chat.
- Offline multi-master editing and automatic three-way merge.
- Synchronization of request/response history, logs, charts, samples, or test results.
- Remote execution on the host or another member's device.
- Scheduled jobs, CI runners, or shared load generation.
- Automatic sharing of tokens, passwords, cookies, API keys, or other detected secrets.
- Legacy Flask application parity.

## User Experience

### Share a project

The project menu and Project Settings expose **Share on local network**. The action opens a project-scoped sharing surface with:

- Project name.
- Sharing status.
- Host device name.
- Local address and port.
- Six-digit pairing code with expiry.
- Copy-address and QR-code actions.
- Connected members and roles.
- Recent project changes.
- Stop-sharing action.

Enabling sharing starts a LAN listener only for the selected project. Sharing is disabled by default and stops when the user explicitly disables it or exits Beacon. A later preference may allow restoring approved host sessions on launch; it is not part of the MVP.

### Discover and join

The sidebar exposes **Join local project**. Beacon searches for advertised hosts on the same network and displays:

- Shared project name.
- Host device name.
- Host address.
- Availability.
- Whether pairing is required.

The user may also enter `host:port` manually when discovery is unavailable or blocked by the network.

Joining requires the current pairing code. The host receives a device approval request containing only the proposed device name and generated device identifier. After approval, the host assigns viewer or editor access. The first approved device is never promoted to owner automatically.

### Local project representation

A joined project appears in the member's ordinary project list with a shared badge and connection state:

```text
Platform API
Shared · connected to Nando MacBook
Revision 84
```

The synchronized project remains visually consistent with a local project. Controls that cannot be used in the current role are disabled with a direct explanation.

### Run behavior

All Send, Test Mode, scenario, load, and rate-limit actions run on the member's current device. Beacon uses that device's private variables, network interface, certificates, and local backend.

Run history records the shared project ID and source revision used for the run, but the history record itself is not synchronized.

The execution UI should disclose the source revision when it helps reproduce a result:

```text
Project source: revision 84
Execution: this device
```

### Stop sharing

Only the owner may stop hosting. Existing clients transition to **Host offline** and retain the last synchronized snapshot. They may duplicate the snapshot into a new private project. They may not continue editing the shared identity while disconnected.

Stopping a host session revokes active session credentials. Previously approved device identities remain in the project's sharing configuration only if the owner chooses to preserve membership for the next host session.

## Shared Data Contract

### Shared project source

The following fields synchronize:

- Project ID, name, description, and source schema version.
- Folder IDs, names, hierarchy, and ordering.
- Endpoint IDs, names, folder placement, ordering, method, URL template, target type, headers, cookies, payload template, and payload type.
- Assertions.
- Response extractors as definitions, not extracted runtime values.
- Project-level test-mode defaults and scenario ordering.
- Environment names and explicitly shared variables.
- Project revision metadata and change records.

Stable IDs are required for projects, folders, endpoints, environments, assertions, and extractors. Display names are not synchronization keys.

### Local-only data

The following data never synchronizes in the MVP:

- Other projects in the workspace.
- Application settings and analytics preferences.
- Run history, responses, logs, charts, samples, errors, and timing metrics.
- Current editor state, selection, expanded folders, or window layout.
- Local certificates, proxy configuration, and operating-system credentials.
- Extracted token values and runtime mutations produced by a request.
- Private environment values.

### Shared and private variables

Environment variable definitions have an explicit scope:

```json
{
  "key": "base_url",
  "scope": "shared",
  "value": "https://staging.example.com"
}
```

```json
{
  "key": "access_token",
  "scope": "private",
  "value": null
}
```

A private variable's key may synchronize so endpoint templates remain understandable, but its value does not leave the device. Each member supplies the value locally.

Beacon treats likely credentials as private by default. Detection includes case-insensitive names containing terms such as `token`, `secret`, `password`, `authorization`, `cookie`, `api_key`, and `private_key`. A user may explicitly classify a value as shared after a warning, but the default must fail closed.

Response extractors that write into project variables write to a device-local runtime overlay. They do not mutate the synchronized shared value. This prevents one member's login response from broadcasting a bearer token to the team.

## Source and Revision Model

### Revision sequence

Every accepted mutation increments a project-scoped integer revision by one. Revisions are ordered by the host and contain the complete information needed to understand the accepted change.

```json
{
  "id": "revision-uuid",
  "project_id": "project-uuid",
  "revision": 84,
  "base_revision": 83,
  "actor_device_id": "device-uuid",
  "actor_name": "QA Windows",
  "operation": "endpoint.updated",
  "target_type": "endpoint",
  "target_id": "endpoint-uuid",
  "summary": "Updated assertion on POST /auth/login",
  "patch": {},
  "created_at": "2026-07-25T08:32:00Z"
}
```

The host commits the source mutation and revision record atomically. A broadcast occurs only after persistence succeeds.

### Mutation envelope

Clients submit mutations against the last revision they have acknowledged:

```json
{
  "mutation_id": "client-generated-uuid",
  "project_id": "project-uuid",
  "base_revision": 83,
  "operation": "endpoint.updated",
  "target_id": "endpoint-uuid",
  "payload": {}
}
```

`mutation_id` makes retries idempotent. The host stores recently accepted mutation IDs and returns the original result when a client repeats the same mutation.

### Change operations

The first protocol supports explicit operations rather than arbitrary document replacement:

- `project.updated`
- `folder.created`, `folder.updated`, `folder.moved`, `folder.deleted`
- `endpoint.created`, `endpoint.updated`, `endpoint.moved`, `endpoint.deleted`
- `environment.created`, `environment.updated`, `environment.deleted`
- `variable.shared`, `variable.updated`, `variable.removed`
- `member.role_changed`, `member.removed`

Explicit operations improve validation, audit summaries, permissions, and future migration behavior.

### Conflict behavior

If `base_revision` is current, the host validates and applies the mutation.

If newer revisions do not touch the same entity or ordering boundary, the host may safely rebase the operation and return the accepted revision. Otherwise, it returns a structured conflict:

```json
{
  "error": "revision_conflict",
  "current_revision": 86,
  "target_id": "endpoint-uuid",
  "changed_by": "Nando MacBook",
  "latest_entity": {}
}
```

The UI offers:

- Use latest version.
- Review differences.
- Save my version as a copy.

The MVP does not merge two endpoint bodies or header collections automatically.

### Change history

The project sharing surface shows an append-only activity view:

```text
14:30 Nando added POST /auth/login
14:32 QA Windows changed its status assertion to 201
14:35 Nando moved GET /users/me into Auth
14:41 QA Windows updated the shared staging base URL
```

Change history stores source mutations only. It does not contain resolved variables, request bodies after substitution, response data, or run results.

## Host Architecture

### Components

```text
Beacon member desktop
  React UI
      ↓ local commands
  Local FastAPI backend
      ↓ HTTPS/WebSocket over LAN
Beacon host backend
  pairing and session auth
  project mutation service
  revision repository
  event broadcaster
      ↓
  local SQLite database
```

The React UI continues to communicate with its own local backend. The local backend owns the remote host connection. Browser code must not directly manage LAN credentials or synchronization sockets.

### Persistence

Shared-project state and revisions should use SQLite rather than the current whole-file JSON rewrite path. Concurrent members, atomic revisions, idempotent mutations, and reconnect queries require transactional persistence.

The recommended database location is `<BEACON_DATA_DIR>/workspace.db`, with:

- WAL mode.
- Foreign keys enabled.
- Bounded busy timeout.
- Short transactions.
- Ordered schema migrations.
- Repository interfaces separating routes from SQL.

Personal projects may continue using the current configuration format during an incremental migration. A shared project is migrated into the repository when sharing is first enabled. The migration must preserve stable IDs and create revision 1 as an import snapshot.

### Proposed tables

#### `shared_projects`

- `project_id TEXT PRIMARY KEY`
- `owner_device_id TEXT NOT NULL`
- `current_revision INTEGER NOT NULL`
- `source_schema_version INTEGER NOT NULL`
- `sharing_enabled INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### `project_revisions`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `revision INTEGER NOT NULL`
- `base_revision INTEGER NOT NULL`
- `mutation_id TEXT NOT NULL`
- `actor_device_id TEXT NOT NULL`
- `operation TEXT NOT NULL`
- `target_type TEXT NOT NULL`
- `target_id TEXT`
- `summary TEXT NOT NULL`
- `patch_json TEXT NOT NULL`
- `created_at TEXT NOT NULL`

Unique constraints cover `(project_id, revision)` and `(project_id, mutation_id)`.

#### `project_members`

- `project_id TEXT NOT NULL`
- `device_id TEXT NOT NULL`
- `device_name TEXT NOT NULL`
- `role TEXT NOT NULL`
- `public_key TEXT`
- `approved_at TEXT NOT NULL`
- `last_seen_at TEXT`
- `revoked_at TEXT`

#### `device_sessions`

- Session identifier.
- Project and device identifiers.
- Hashed session credential.
- Issued and expiry timestamps.
- Revocation timestamp.

Pairing codes are short-lived and stored only as a hash with expiry and attempt counters.

## Discovery and Transport

### Discovery

The preferred discovery mechanism is mDNS/DNS-SD with a Beacon-specific service type. Advertisements contain only:

- Service protocol version.
- Host address and port.
- Host device display name.
- Shared project display name and ID.
- Whether pairing is open.

Advertisements never contain project content, membership, variables, or credentials.

Manual `host:port` entry is required because enterprise, guest, VPN, and segmented Wi-Fi networks often block multicast discovery.

### Transport

The host exposes a versioned LAN collaboration surface. Initial snapshots and bounded revision catch-up use HTTP. Live changes and connection state use WebSocket.

Proposed routes:

```text
POST /local-share/projects/{project_id}/pair
POST /local-share/projects/{project_id}/pair/approve
POST /local-share/projects/{project_id}/sessions/refresh
GET  /local-share/projects/{project_id}/snapshot
GET  /local-share/projects/{project_id}/revisions?after=83
POST /local-share/projects/{project_id}/mutations
GET  /local-share/projects/{project_id}/members
PATCH /local-share/projects/{project_id}/members/{device_id}
DELETE /local-share/projects/{project_id}/members/{device_id}
WS   /local-share/projects/{project_id}/events
```

WebSocket event types:

- `sync.ready`
- `revision.committed`
- `member.joined`
- `member.updated`
- `member.removed`
- `pairing.requested`
- `host.shutting_down`
- `sync.resnapshot_required`

Every message includes protocol version, project ID, current revision, event ID, and timestamp.

### Reconnection

A client reconnects with its last acknowledged revision. The host returns missing revisions when they are still retained and compatible. If the gap is unavailable or the source schema changed incompatibly, the host instructs the client to download a fresh snapshot.

## Roles and Permissions

### Owner

- Enable and stop sharing.
- Approve, remove, and change member roles.
- Read and edit project source.
- Review all revisions.
- Resolve or revert changes.

### Editor

- Read the shared project.
- Submit source mutations.
- View source change history.
- Run requests locally.
- Maintain private variables locally.

### Viewer

- Read synchronized project source.
- Run requests locally.
- Maintain private variables locally.
- Duplicate the current snapshot into a private project.
- Cannot submit shared mutations.

Permissions are enforced by the host backend. Disabled UI controls are explanatory convenience, not the security boundary.

## Security Model

### Default closed

The LAN listener is disabled unless an owner explicitly shares a project. It binds only to appropriate local interfaces and must not silently expose the ordinary unrestricted backend API.

### Pairing

- Six-digit code generated with a cryptographically secure random source.
- Short expiry, recommended five minutes.
- Bounded failed attempts per source and project.
- Host approval after a correct code.
- Per-device session credential after approval.
- Credentials stored using operating-system secure storage where available.

### Encryption and identity

LAN traffic must not rely on network trust alone. The implementation plan must choose and validate one of:

1. Host-generated self-signed TLS identity with certificate fingerprint verified during pairing.
2. An authenticated Noise-style channel over the LAN transport.

Plain HTTP carrying project source or session credentials is not an acceptable release configuration. Development-only insecure transport must be clearly gated and never enabled in packaged builds.

### Authorization

Every snapshot, revision, mutation, membership, and WebSocket request is scoped to one project and authenticated as one approved device. The host verifies the role for each operation.

### Secret handling

- Private values never enter mutation payloads or revisions.
- Secret-like keys default to private.
- Host logs must redact authorization headers, cookies, pairing codes, and session credentials.
- Snapshots exclude runtime overlays and extracted values.
- QR codes may contain host address, project ID, protocol version, and an ephemeral pairing reference; they must not contain a durable session credential.

### Network boundaries

The feature is intended for trusted local networks, but still requires authentication and encryption. Beacon warns when hosting on interfaces classified as public or when the operating system firewall exposes the listener broadly.

## UI States

Host project states:

- Private.
- Starting host.
- Shared, pairing closed.
- Shared, pairing open with expiry countdown.
- Member approval requested.
- Stopping.
- Host error.

Member project states:

- Discovering.
- Pairing required.
- Waiting for host approval.
- Downloading snapshot.
- Connected and synchronized.
- Applying revisions.
- Conflict requires attention.
- Reconnecting.
- Host offline, read-only snapshot.
- Access revoked.
- Protocol upgrade required.

Connection state must be visible near the project identity, not hidden only in Settings. Detailed membership and revision history may live in Project Settings.

## Failure Behavior

- A failed source synchronization never blocks local request execution against the last valid snapshot.
- A failed mutation remains clearly unsaved and is not presented as synchronized.
- Persistence failure on the host rejects the mutation and does not broadcast it.
- Malformed or unauthorized messages close the affected session without affecting other members.
- Host shutdown broadcasts a best-effort event before closing connections.
- Duplicate messages are idempotent by mutation and event IDs.
- A corrupt local synchronized cache can be discarded and rebuilt from a fresh host snapshot without touching run history.

## Cloud Compatibility

The local host and a future cloud workspace should implement the same conceptual contract:

```text
Today: Beacon client → local Beacon host
Later: Beacon client → hosted Beacon sync service
```

Reusable concepts include:

- Stable entity IDs.
- Project-scoped membership.
- Revision and mutation envelopes.
- Optimistic concurrency.
- Snapshot plus incremental catch-up.
- Shared/private variable scope.
- Local execution and local history.

Cloud accounts, invitations, organization ownership, durable remote storage, internet transport, billing, and compliance require a separate approved design.

## Implementation Phases

### Phase 1: Storage and revision foundation

- Introduce shared-project repository interfaces and SQLite schema.
- Migrate one project into a revisioned source representation.
- Implement atomic mutation application, idempotency, revision queries, and source snapshots.
- Add secret classification and shared/private variable behavior.
- Keep all access local to one process while verifying repository semantics.

### Phase 2: Host and join MVP

- Start and stop a project-scoped LAN host.
- Implement manual-address join, pairing, approval, session authentication, roles, snapshot transfer, and WebSocket revision broadcasts.
- Display clear host/member connection state.
- Keep clients read-only while disconnected.

### Phase 3: Discovery and collaboration safety

- Add mDNS discovery.
- Add revision catch-up and resnapshot behavior.
- Add structured conflict UI and save-as-copy escape hatch.
- Add member management and activity history.
- Complete packaged-build encryption and firewall behavior across Windows, macOS, and Linux.

### Phase 4: Product hardening

- Retention and compaction for old revision payloads without losing audit summaries.
- Revert-to-revision workflow.
- Protocol compatibility tests.
- Network interruption, duplicate delivery, stale client, and host restart testing.
- Documentation for hosting, joining, private variables, and troubleshooting.

## Verification Strategy

### Automated

- Repository tests for atomic revision increments and rollback.
- Idempotent mutation retry tests.
- Permission tests for owner, editor, viewer, removed member, and expired session.
- Secret-classification and snapshot-redaction tests.
- Conflict tests for same-entity edits and safe independent changes.
- Snapshot plus revision catch-up tests.
- WebSocket reconnect and duplicate event tests.
- Schema and protocol compatibility tests.
- Tests confirming that runs and run history never enter synchronization payloads.

### Integration

- Two Beacon processes on one machine using separate data directories.
- Windows-to-macOS, macOS-to-Linux, and Windows-to-Linux sessions on the same LAN.
- Manual join with mDNS unavailable.
- Host restart and member reconnection.
- Firewall denied, public network, VPN, and Wi-Fi isolation behavior.
- Concurrent independent endpoint edits and conflicting same-endpoint edits.

### Manual product checks

- A user can identify exactly which project is being shared.
- A member cannot infer names or data from unshared projects.
- A viewer can run locally but cannot edit shared source.
- An editor sees another accepted change without reloading the project.
- A token extracted during login remains on the executing device.
- Host-offline state is obvious and does not imply that edits are synchronized.
- Change history identifies actor, action, target, revision, and time without leaking secrets.

## Acceptance Criteria

- Sharing is enabled explicitly for one project and exposes no other workspace project.
- A second Beacon desktop on the same network can pair, receive the project, and reconnect securely.
- Owner, editor, and viewer permissions are enforced by the host.
- An accepted change creates exactly one ordered revision and appears on connected members.
- Retrying the same mutation does not create a duplicate revision.
- A stale conflicting edit is rejected with enough information for a safe user decision.
- Shared environment values synchronize; private values and runtime extractor results do not.
- Requests execute on the initiating device, and results/history remain on that device.
- Disconnected shared projects are clearly read-only and retain their last valid snapshot.
- Windows, macOS, and Linux packaged builds can host and join with documented firewall behavior.
- The protocol and repository boundary do not require React components to know whether a future source host is local or cloud-based.

## Open Technical Decisions

These questions must be resolved in the implementation plan before network code is shipped:

1. Whether `workspace.db` replaces project JSON for all projects or initially stores shared projects only.
2. The packaged-build encrypted transport: TLS fingerprint pairing or another authenticated channel.
3. The exact mDNS service name and platform library.
4. Whether one Beacon instance may host several projects on one listener in the first release.
5. Revision payload retention and compaction policy.
6. Whether approved membership persists after sharing is stopped.
7. How project deletion behaves while members hold synchronized snapshots.
8. Whether shared environment names with all-private values should synchronize automatically.

Until those decisions are approved, the product contract remains: **one project is shared, source changes are revisioned, execution remains local, and secrets remain private by default.**
