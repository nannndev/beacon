# Getting Started

Beacon is a modern API workspace that combines Postman-style organization with powerful load testing and security testing capabilities.

## Quick Start (Web Version)

### Prerequisites

- Node.js 18+
- Python 3.10+
- Git

### 1. Clone & Install

```bash
git clone https://github.com/nannndev/beacon.git
cd security-tools
npm install
cd backend && pip install -r requirements.txt && cd ..
```

### 2. Run Everything

```bash
npm run dev
```

- Backend → http://localhost:8000
- Frontend → http://localhost:5173

Open the frontend in your browser.

## First Steps

Fresh installs start with a ready-to-run **Default Project** targeting the
public JSONPlaceholder API. Its 47 requests cover GET, filters, POST, PUT,
PATCH, DELETE, and nested relations across Posts, Comments, Albums, Photos,
Todos, and Users. Defaults are intentionally conservative: one worker, ten
requests, and two requests per second.

1. Select any sample endpoint and use **Single Send** or a test mode.
2. Create folders and endpoints for your own API, or **Import from Postman**.
3. If you already had a Beacon workspace before this sample was introduced,
   use **Add Sample Project** in the project sidebar. The action is idempotent
   and never overwrites an existing project.

## Using Folders

Beacon supports deep nested folders:

- Click **New Folder**
- You can nest folders inside folders
- Use **Run Folder** to execute all requests inside a folder (including subfolders)

## Desktop Version

See the [Desktop App](./desktop.md) section for how to build and use the native desktop version (includes automatic backend startup).

## Next Steps

- [Installation](./installation.md)
- [Folders & Organization](./features/folders.md)
- [Postman Import](./features/postman-import.md)
- [Variables & Extractors](./features/variables.md)
- [Assertions](./features/assertions.md) — attach pass/fail rules to endpoints
- [Scenarios](./features/scenarios.md) — run ordered multi-step flows with state carried by extractors
- [Send & Response Inspector](./features/send-inspect.md) — fire one request and inspect everything (with click-to-extract)
- [Run History](./features/run-history.md) — retain, pin, expand charts, and compare two test runs

See the full list under `docs/features/`.

## Desktop + MCP

The desktop app bundles everything (including the MCP server) as native binaries. See [Desktop App](./desktop.md) and [MCP Server](./mcp.md).
