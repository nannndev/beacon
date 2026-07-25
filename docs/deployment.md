# Deployment & Server Specification

## Recommended public setup (landing only)

Beacon is distributed as a **local Windows, macOS, and Linux desktop application**.
The public landing page is a static Vite build on Vercel; it does not run the
FastAPI test engine on a shared server:

```text
Vercel (static landing)
          │
          └── Download CTA ──▶ GitHub Releases ──┬─▶ Windows x64 .exe
                                                 ├─▶ macOS arm64 .dmg
                                                 └─▶ Linux x64 .AppImage / .deb
                                                          │
                                                          ├── React desktop UI
                                                          ├── local FastAPI sidecar
                                                          ├── local MCP sidecar
                                                          └── per-user local data
```

Requests and load tests originate from the user's machine. This keeps API
credentials local and lets Beacon reach localhost, VPN, and private staging
targets that a hosted service cannot reach.

### Vercel configuration

The production landing is connected to this GitHub repository through Vercel's
Git integration. Use these project settings:

| Setting | Value |
|---------|-------|
| Production branch | `main` |
| Framework preset | Vite |
| Root directory | `landing` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | `20` |

Set these build-time environment variables in the Vercel project:

```text
VITE_DOWNLOAD_URL=https://github.com/nannndev/beacon/releases/latest
VITE_GITHUB_URL=https://github.com/nannndev/beacon
VITE_DOCS_URL=https://nannndev.github.io/beacon/
VITE_SUPPORT_URL=https://buymeacoffee.com/ekaprasety8
VITE_DISCORD_URL=https://discord.gg/YOUR-INVITE
```

Only `VITE_DOWNLOAD_URL` is required for the installer flow. Vercel watches
`main` and deploys the static bundle automatically, so the repository does not
need a deployment token or a hosted Beacon backend.

### Desktop release flow

The release workflow builds Windows NSIS (`.exe`), an unsigned macOS Apple
Silicon disk image (`.dmg`), and Linux x64 `.AppImage` and `.deb` packages:

1. Builds the installer on every pull request and push to `main` for validation.
2. Publishes a GitHub Release when a semantic version tag such as `v0.2.4` is pushed.
3. Can create a draft release from **Actions → Release Desktop App → Run workflow**.
4. Uploads installers for all three platforms; Python, FastAPI, and the MCP server are bundled.

The landing CTA uses `/releases/latest`, so it automatically follows the newest
non-draft release without changing or rebuilding the landing site.

---

Beacon also contains independently buildable web pieces for development or a
future hosted service. Public desktop users do not need those services: the
frontend, backend, MCP server, and data store all run on their own computer.

| Piece | What it is | Runtime | Needs a server? |
|-------|-----------|---------|-----------------|
| **Landing** (`landing/`) | Marketing site + download links | Static (HTML/CSS/JS) | ❌ Vercel / static CDN |
| **Frontend** (`frontend/`) | The React web app (dashboard) | Static (HTML/CSS/JS) | ❌ Static host / CDN |
| **Backend** (`backend/`) | FastAPI API + WebSocket + test runner | Python 3.11+ | ✅ Long-running process |
| **Docs** (`docs/`) | This VitePress site | Static | ❌ Static host / CDN |

The **landing** and **frontend** are pure static bundles once built — no Node
runtime in production. Only the **backend** needs an always-on server.

## Ports (development)

All ports come from the single root `.env` (see [`.env.example`](https://github.com/nannndev/beacon/blob/main/.env.example)).

| Service | Env var | Default |
|---------|---------|---------|
| Backend (FastAPI/uvicorn) | `BACKEND_PORT` | `8000` |
| Frontend (Vite) | `FRONTEND_PORT` | `5173` |
| Docs (VitePress) | `DOCS_PORT` | `5174` |
| Landing (Vite) | `LANDING_PORT` | `5175` |

In production the static pieces are served by your host on `:80/:443`; only the
backend keeps a fixed listen port.

---

## Landing (`landing/`)

Static marketing site. Build once, serve the output anywhere.

```bash
cd landing
pnpm install
pnpm build          # → landing/dist/
```

**Spec**

- **Build**: Node 18+/20 + pnpm (build-time only).
- **Output**: `landing/dist/` — static assets (~200 KB JS gzip + logo images).
- **Runtime**: any static host / CDN. No server process.
- **Resources**: negligible (bandwidth only).

**CTA links** (build-time env, all optional):

| Env var | Default |
|---------|---------|
| `VITE_DOWNLOAD_URL` | `https://github.com/nannndev/beacon/releases/latest` |
| `VITE_DOCS_URL` | `https://nannndev.github.io/beacon/` |
| `VITE_SUPPORT_URL` | `https://buymeacoffee.com/ekaprasety8` |
| `VITE_GITHUB_URL` | `https://github.com/nannndev/beacon` |
| `VITE_DISCORD_URL` | *(set to your Discord invite)* |

**Current host**: Vercel using the Git integration described above. Netlify,
Cloudflare Pages, or any S3/NGINX static bucket can also serve the same `dist/`.

---

## Frontend web app (`frontend/`)

The dashboard. Also a static bundle, but it **talks to the backend**, so it
needs to know the backend URL and the backend must allow its origin (CORS).

```bash
cd frontend
pnpm install
pnpm build          # → frontend/dist/
```

**Spec**

- **Build**: Node 18+/20 + pnpm.
- **Output**: `frontend/dist/` — static assets.
- **Runtime**: static host / CDN.
- **Backend URL**: set `VITE_BACKEND_URL` at build time to the public backend
  origin (e.g. `https://api.beacon.example.com`). Without it, a production
  build falls back to `http://127.0.0.1:8000`, which only works locally.
- **WebSocket**: the live run stream uses `/ws`, derived from the same base
  (http→ws, https→wss). Your backend host must allow WebSocket upgrades.

> **CORS:** the backend only allows the `:5173` origin out of the box. When you
> host the web app on a real domain, add that origin to the CORS allowlist in
> `backend/app/main.py` (see below).

---

## Backend API (`backend/`)

The only piece that needs a real server. FastAPI served by uvicorn; spawns
daemon threads to run tests and broadcasts progress over a WebSocket.

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# production: add a process manager + workers, e.g.
#   uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

**Spec**

| Item | Value |
|------|-------|
| Language / runtime | Python **3.11+** (CI builds on 3.13) |
| Framework | FastAPI + uvicorn (`uvicorn[standard]` for WebSocket) |
| Listen | `0.0.0.0:${BACKEND_PORT}` (default 8000) |
| Protocols | HTTP REST + one `/ws` WebSocket |
| CPU / RAM (idle) | 1 vCPU / 256–512 MB is plenty |
| CPU / RAM (load testing) | scale CPU with concurrency; the runner uses a thread pool |
| Persistence | a single JSON file — see below |
| Scaling | **single instance** (state is in-memory; see caveats) |

### Persistence

State lives in **one JSON file**, not a database:

- Path: `config/tests.json`, resolved **relative to the process working
  directory** (so run uvicorn from `backend/` → `backend/config/tests.json`).
- The desktop app overrides this with `BEACON_DATA_DIR` (a per-user writable
  dir) — set the same env var in a container to point at a mounted volume.
- The whole file is rewritten on every mutation.

> ⚠️ **Secret material:** `tests.json` can hold real bearer tokens / JWTs and
> live target URLs. Keep it on a private volume, never in a public bucket, and
> it stays out of git (`.gitignore` covers it).

### Runtime caveats (why single-instance)

- In-flight runs live in an in-memory `current_runs` dict and are **lost on
  restart**. Don't put the backend behind a load balancer with >1 replica — the
  WebSocket clients and run state won't be shared.
- Tests run on daemon threads inside the process; give the container enough CPU
  headroom for the concurrency you configure per endpoint.

### CORS

`backend/app/main.py` currently allows only the dev frontend origin
(`http://localhost:5173`). To serve the hosted web app, add its origin:

```python
allow_origins=[
    "http://localhost:5173",
    "https://app.beacon.example.com",  # your deployed frontend
]
```

**Recommended hosts**: Render, Railway, Fly.io, a small VPS, or any Docker
host. A minimal container:

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
ENV BEACON_DATA_DIR=/data
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## Reference topology

A typical hosted setup:

```
 ┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
 │  Landing    │     │  Frontend   │     │  Backend API     │
 │ (static CDN)│     │ (static CDN)│ ──▶ │ FastAPI + /ws     │
 │ beacon.dev  │     │ app.beacon  │     │ api.beacon (VPS)  │
 └─────────────┘     └─────────────┘     └────────┬─────────┘
        │ Download                                 │ tests.json
        ▼                                          ▼
  GitHub Releases                            mounted volume
```

- Landing → Vercel; Docs → GitHub Pages. A separately hosted web frontend is optional.
- Backend → one always-on instance with a persistent volume.
- Windows and macOS desktop installers → published by GitHub Actions on a version tag:
  1. After merging your changes, update version in `frontend/src-tauri/tauri.conf.json` + `Cargo.toml` if needed.
  2. `git tag vX.Y.Z`
  3. `git push origin vX.Y.Z`
  - This triggers Windows NSIS and macOS Apple Silicon builds and attaches the `.exe` and `.dmg` to a GitHub Release.
  - You can also manually trigger via Actions (with "publish_release" checked) if you don't want to tag immediately.
  See `.github/workflows/release-desktop.yml` for details. The landing page links to `/releases/latest`.

## Checklist for a hosted web-app deployment

The checklist below applies only if you later host the React dashboard and
FastAPI backend as a web service. It is not required for the recommended
landing-only + local-desktop setup.

- [ ] Build frontend with `VITE_BACKEND_URL` pointing at the public backend.
- [ ] Add the frontend origin to the backend CORS allowlist.
- [ ] Mount a persistent, **private** volume for `tests.json` (`BEACON_DATA_DIR`).
- [ ] Terminate TLS in front of the backend and allow WebSocket upgrades.
- [ ] Set the landing CTA env vars (`VITE_DISCORD_URL`, etc.).
- [ ] Run the backend as a **single** instance.
