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
| `list_projects` | Projects + active environment/base_url |
| `list_endpoints` | Flattened endpoints in the active project |
| `search_endpoints` | Search + paginate endpoints without filling agent context |
| `get_endpoint` | Editable endpoint details, redacted sensitive headers, and preflight diagnostics |
| `get_config` | base_url, variable **names** (values hidden), count |
| `create_endpoint` | Add an API request or Web Page target (optionally into a folder) |
| `create_folder` | Add a top-level folder |
| `delete_endpoint` | Remove an endpoint by id or name |
| `import_collection` | Import Beacon, Postman, OpenAPI/Swagger, Insomnia, HAR, JSON, or YAML into a folder |
| `add_endpoint_from_curl` | Build an endpoint from a `curl` command |
| `send_request` | Send once with extractors/assertions and a context-safe response-body limit |
| `run_endpoint` | Fire an endpoint N times (optionally concurrent) → stats |
| `run_scenario` | Run an ordered endpoint chain with shared extracted variables |

`run_endpoint` returns the full snapshot: `attempts`, `success`,
`rate_limited`, `errors`, latency `p50/p95/p99`, status-code mix, `rps`, and
`first_rate_limited_at`.

Tool failures keep the human-readable `error` field and also return a stable
`error_code` such as `invalid_argument`, `endpoint_not_found`, or
`folder_not_found`, allowing agents to recover without parsing prose.

## Agent skill

For agents that prefer skills over raw tool calls, the repo also includes a
`beacon-api-tester` skill (`.claude/skills/beacon/SKILL.md`) that documents this
MCP surface plus a REST fallback.

## Notes

- The MCP server runs as its **own process** with its own in-memory state,
  reading/writing the same `tests.json`. Keep either the web backend **or** the
  MCP server writing at a time to avoid clobbering.
- Variable *values* (which can be secrets/tokens) are never returned by the read
  tools — only variable names.
