# Authorization

Beacon stores authorization as a structured setting on an endpoint, folder, or
project rather than as a hand-written header string. Two things depend on that:
Basic credentials are base64-encoded at request time, and endpoints can inherit
auth from the folder or project that contains them.

## Auth types

| Type | What Beacon sends |
| --- | --- |
| **Inherit** | Whatever the enclosing folder defines, or the project when no folder sets one. This is the default. |
| **None** | No credential — even if a folder or project defines one. |
| **Bearer token** | `Authorization: Bearer <token>` |
| **API key** | A header you name (default `X-API-Key`) |
| **Basic auth** | `Authorization: Basic <base64(username:password)>` |
| **Custom** | A header name and value you supply |

Every field accepts `{{variables}}`, so credentials can come from an
environment rather than the project file.

## Inheritance

Auth resolves from the outside in — project, then each enclosing folder, then
the endpoint. The most specific setting wins:

```
Project        auth: bearer {{project_token}}
└─ Folder "Admin"   auth: bearer {{admin_token}}
   ├─ GET /users    auth: inherit  → Bearer <admin_token>
   └─ GET /health   auth: none     → no Authorization header
└─ GET /status      auth: inherit  → Bearer <project_token>
```

Set an endpoint to **None** to opt a public route out of an authenticated
folder. Set it to a concrete type to override the folder entirely.

## Basic auth and secrets

Username and password are stored separately and encoded when the request is
built, after templating. Point them at variables to keep credentials out of
version control:

```
Username: {{api_user}}
Password: {{api_password}}
```

In a Git-backed project, variables whose names look secret stay in the ignored
`.beacon/` overlay, and CI can supply them through `BEACON_VAR_*`. See
[Git-backed projects](./git-backed-projects.md).

## Existing endpoints

Endpoints that already carry an `Authorization` header keep working unchanged —
Beacon only sends a header from the auth setting when one is configured. When
you do configure auth, it takes precedence over a hand-written `Authorization`
header so switching types cannot leave a stale credential behind.

The CLI resolves the same inheritance chain, so headless and CI runs
authenticate exactly like the desktop app.
