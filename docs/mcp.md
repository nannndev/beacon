# MCP Server

Beacon ships an **MCP (Model Context Protocol) server** so AI agents — Claude
Desktop, Claude Code, or any MCP client — can drive the tester directly:
list and create endpoints, organize folders, import collections, and run /
load-test endpoints, all through the same engine and `tests.json` store the app
uses.

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

## Tools

| Tool | What it does |
|------|--------------|
| `list_projects` | Projects + active environment/base_url |
| `list_endpoints` | Flattened endpoints in the active project |
| `get_config` | base_url, variable **names** (values hidden), count |
| `create_endpoint` | Add an endpoint (optionally into a folder) |
| `create_folder` | Add a top-level folder |
| `delete_endpoint` | Remove an endpoint by id or name |
| `import_collection` | Import Postman v2.1 / Beacon export / raw list / single request |
| `add_endpoint_from_curl` | Build an endpoint from a `curl` command |
| `run_endpoint` | Fire an endpoint N times (optionally concurrent) → stats |

`run_endpoint` returns the full snapshot: `attempts`, `success`,
`rate_limited`, `errors`, latency `p50/p95/p99`, status-code mix, `rps`, and
`first_rate_limited_at`.

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
