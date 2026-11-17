# MCP Server

Beacon ships a **standard MCP (Model Context Protocol) server**.

**This is not Claude-only.** It works with **any** MCP-compatible client:

- Claude Desktop / Claude Code
- Cursor, Windsurf, Cline
- Continue.dev, Zed, VS Code + Continue
- And any other tool that supports MCP stdio servers

The server lets agents:
- list and create endpoints, organize folders, import collections, and run /
  load-test endpoints — all through the same engine and `tests.json` store the app uses.

> Running an endpoint sends **real HTTP requests** to its target. Only point it
> at systems you're authorized to test.

## Run it

From `backend/` (with dependencies installed):

```bash
# stdio — local use with Claude Desktop / Claude Code
python -m app.mcp_server

# HTTP / SSE — hostable / shared
BEACON_MCP_TRANSPORT=http BEACON_MCP_PORT=8765 python -m app.mcp_server
```

| Env var | Default | Purpose |
|---------|---------|---------|
| `BEACON_MCP_TRANSPORT` | `stdio` | `stdio`, `http` (streamable-http), or `sse` |
| `BEACON_MCP_HOST` | `127.0.0.1` | bind host (HTTP mode) |
| `BEACON_MCP_PORT` | `8765` | bind port (HTTP mode) |
| `BEACON_DATA_DIR` | *(unset)* | override where `tests.json` lives |

## Connect

The Beacon MCP server uses the standard stdio transport. Any MCP client can connect to it.

### Claude (easiest — one click from the desktop app)

**Claude Code:**

```bash
claude mcp add beacon -- python -m app.mcp_server   # run from backend/
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "beacon": {
      "command": "python",
      "args": ["-m", "app.mcp_server"],
      "cwd": "/absolute/path/to/beacon/backend"
    }
  }
}
```

### Other MCP clients (Cursor, Windsurf, Cline, Continue, etc.)

Most clients use a similar JSON config. Use the **standalone binary** from the desktop app (recommended) or point to Python.

**Recommended (Desktop app):**
1. Open Beacon desktop → click **MCP**
2. Copy the **Server Binary** path
3. In your client settings, add a new MCP server with this config:

```json
{
  "mcpServers": {
    "beacon": {
      "command": "/absolute/path/to/mcp_server.exe",
      "args": []
    }
  }
}
```

**From source (requires Python):**

```json
{
  "mcpServers": {
    "beacon": {
      "command": "python",
      "args": ["-m", "app.mcp_server"],
      "cwd": "/absolute/path/to/beacon/backend"
    }
  }
}
```

### Example: Cursor

1. Open Cursor Settings → Features → MCP
2. Click "Add custom MCP"
3. Use:
   ```json
   {
     "command": "C:\\Users\\you\\AppData\\Roaming\\com.beacon.app\\mcp_server.exe",
     "args": []
   }
   ```

Or paste the full `mcpServers` object from the Beacon app.

Common locations:
- **Cursor**: `~/.cursor/mcp.json` (or per-project)
- **Windsurf / Cline**: Look for MCP / Custom tools settings
- **Continue.dev**: `~/.continue/config.json`

The desktop app's **MCP** panel gives you the exact snippet tailored to your machine.

## Desktop app (no Python needed)

The Beacon desktop app bundles the MCP server as a standalone binary — you do
**not** need Python installed.

**Important:** The MCP server itself is universal. It is **not locked to Claude**.

Open **MCP** in the app to:

- One-click register/unregister with **Claude Desktop** and **Claude Code**.
- Copy the ready-to-paste stdio config for **any** MCP client (Cursor, Windsurf, Cline, Continue, Zed, etc.).

Beacon only ever touches its own `beacon` entry in client configs.

The bundled binary is staged at a stable per-user path
(`%APPDATA%\com.beacon.app\mcp_server.exe` on Windows) so registrations keep
working across app updates.

## Tools

The tools are the same no matter which client you use.

| Tool | What it does |
|------|--------------|
| `beacon_list_projects` | Projects with their active environment and base URL |
| `beacon_switch_project` | Make another project active |
| `beacon_create_project` | Create a project and make it active |
| `beacon_get_config` | Base URL, environment, variable **names** (values hidden), endpoint count |
| `beacon_list_endpoints` | Endpoints in the active project |
| `beacon_search_endpoints` | Search and paginate endpoints without filling the agent's context |
| `beacon_get_endpoint` | Full endpoint details (headers, payload, auth, extractors, assertions) |
| `beacon_create_endpoint` | Add an endpoint, optionally into a folder (`"Parent/Child"`) |
| `beacon_update_endpoint` | Change an endpoint's fields |
| `beacon_duplicate_endpoint` | Copy an endpoint |
| `beacon_delete_endpoint` | Remove an endpoint by id or name |
| `beacon_add_endpoint_from_curl` | Build an endpoint from a `curl` command |
| `beacon_get_collection` | The folder tree in display order |
| `beacon_organize_collection` | Create, rename, delete, move, and reorder folders and endpoints in one atomic call |
| `beacon_import_collection` | Import Beacon, Postman, OpenAPI/Swagger, Insomnia, or HAR (JSON or YAML) |
| `beacon_analyze_code` | Scan a local folder or GitHub repo for routes, specs, frameworks, auth, and base URL |
| `beacon_import_code` | Turn that analysis into a project with a folder per module |
| `beacon_probe_endpoint` | Send one request to an endpoint or ad-hoc URL and return the response |
| `beacon_capture_baseline` | Send once and save the live response as the documented example |
| `beacon_set_example_response` | Write the documented example response by hand |
| `beacon_run_collection` | Run endpoints in order, chaining extracted variables |
| `beacon_run_endpoint` | Fire one endpoint N times (optionally concurrent) and return stats |
| `beacon_run_load_test` | Load, spike, stress, or smoke test an endpoint or URL |
| `beacon_list_variables` | Project and environment variables |
| `beacon_set_variable` | Create or update a variable |

`beacon_run_endpoint` returns the full snapshot: `attempts`, `success`,
`rate_limited`, `errors`, latency `p50/p95/p99`, status-code mix, `rps`, and
`first_rate_limited_at`.

A failed tool call returns an `error` field with a readable reason.

### Code to project

`beacon_analyze_code` accepts a local folder path (`~/code/shop-api`), an
`owner/repo`, or a GitHub URL (`https://github.com/owner/repo/tree/develop`).
GitHub sources need GitHub connected in **Settings** with a personal access
token. Call `beacon_import_code` with the same `source` afterwards; pass an
`endpoints` list to import a corrected set instead of the detected one, or
`into_active_project: true` to add to the current project.

## Agent skill

For agents that prefer skills over raw tool calls, the repo also includes a
`beacon-api-workbench` skill (`.claude/skills/beacon-api-workbench/SKILL.md`, also installable with `npx skills add nannndev/beacon`) that documents this
MCP surface plus a REST fallback.

## Notes

- The MCP server runs as its **own process** with its own in-memory state,
  reading/writing the same `tests.json`. Keep either the web backend **or** the
  MCP server writing at a time to avoid clobbering.
- Variable *values* (which can be secrets/tokens) are never returned by the read
  tools — only variable names.
