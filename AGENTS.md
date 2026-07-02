# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A dynamic API endpoint tester / load + rate-limit testing tool. The user defines endpoints (URL, method, headers, payload) and fires them repeatedly and/or concurrently, watching live stats (`attempts`, `success`, `rate_limited`, `errors`) and logs. Payloads/headers/URLs support `{{variable}}` templating with both static config variables and fresh-per-request generators. Intended for authorized testing of APIs (the seeded config targets `api.retailku.com`).

## Two coexisting implementations

The repo contains **two parallel backends** that share an identical core engine:

1. **Legacy Flask app** (`app.py` + `core/tester.py` + `templates/index.html`) — Flask + Flask-SocketIO, single-file CDN-based HTML dashboard, serves on **port 5000**.
2. **Current FastAPI + React app** (`backend/app/main.py` + `backend/app/core/tester.py` + `frontend/`) — FastAPI on **port 8000**, React/Vite/shadcn frontend on **port 5173**. This is the direction described in `README.md`.

**Critical gotcha:** [core/tester.py](core/tester.py) and [backend/app/core/tester.py](backend/app/core/tester.py) are byte-for-byte duplicates of the engine. Any change to the testing logic must be made in **both** files (the FastAPI version's `EndpointTest.duplicate` additionally carries `extractors`). The HTTP/route layers differ between the two backends and are not duplicated.

## Running

### FastAPI backend (current)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### React frontend (current)
```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc typecheck + vite build
```
The frontend hardcodes the backend at `http://localhost:8000` (see [frontend/src/App.tsx](frontend/src/App.tsx) and [frontend/src/components/EndpointEditor.tsx](frontend/src/components/EndpointEditor.tsx)). CORS in `main.py` only allows the `:5173` origin.

### Legacy Flask app
```bash
pip install -r requirements.txt
python app.py    # http://localhost:5000
```

There is no test suite, linter config, or build step for the Python side.

## Config persistence — path is cwd-relative (gotcha)

Both backends read/write `CONFIG_FILE = "config/tests.json"` **relative to the current working directory**. The Flask app runs from the repo root, so it uses `./config/tests.json`. The FastAPI README says to `cd backend` first, which would make it use `backend/config/tests.json` instead — be aware the two backends can end up reading different config files depending on cwd. Config is the single source of truth; there is no database. The whole config is rewritten on every mutation via `save_config()`.

## Core engine architecture ([core/tester.py](core/tester.py))

Three classes model everything:
- **`EndpointTest`** — one endpoint definition (id, name, url, method, headers, payload, `payload_type` of `json`/`form`/`multipart`, and `extractors`). `to_dict`/`from_dict` are the JSON serialization contract used by both the API layer and `tests.json`.
- **`TestConfig`** — `base_url`, `variables` dict, and a list of `EndpointTest`. Relative endpoint URLs are joined onto `base_url`.
- **`APITester`** — the runner. Driven by callbacks (`log_callback`, `stats_callback`) and a shared mutable `stop_flag` dict (`{"stop": bool}`) for cooperative cancellation. Runs sequentially with `delay` throttling, or via `ThreadPoolExecutor` when `concurrency > 1`.

### Templating (`_substitute` / `_generate_dynamic`)
`{{...}}` tokens are resolved in two passes inside every string (and recursively through dicts/lists):
1. **Static** — `config.variables` keys are literal string-replaced first.
2. **Dynamic generators** — regex-matched and regenerated **fresh per request**: `random_email`, `random_phone` (hardcoded Indonesian `+62812…` format), `random_uuid`/`uuid`, `timestamp`, `random_string` / `random_string:<len>`, `random_number`/`random_int` / `random_int:<min>:<max>`. Unknown tokens are left intact as `{{token}}`.

### Extractors (token refresh)
After a successful (2xx) response, `extractors` (e.g. `{"access_token": "body.access_token"}`) pull values out of the JSON body (dot-path) or `Set-Cookie` header and **write them back into `config.variables`**, so chained runs (login → use token) stay fresh. This mutates shared config state at runtime.

### Success / rate-limit detection
Success = 2xx. Rate-limited = HTTP 429 **or** the response text containing "rate"/"too many" (substring heuristic).

## Run lifecycle (both backends)

`POST /run` spawns a **daemon thread** running `APITester.run()` and returns a `run_id`. Progress is pushed live (Flask: SocketIO events `log_update`/`stats_update`/`run_finished`; FastAPI: a single `/ws` WebSocket broadcasting `{type: "log"|"stats", ...}` to all connected clients). `GET /status/<run_id>` polls the last 100 logs + current stats; `POST /stop/<run_id>` sets the stop flag. Runs are kept in an in-memory `current_runs` dict and are lost on restart. The React frontend currently uses polling (`/status`), not the WebSocket.

## Shared REST surface
`GET/POST /config`, `GET/POST /tests`, `PUT/DELETE /tests/<id>`, `POST /tests/<id>/duplicate`, `POST /run`, `POST /stop/<id>`, `GET /status/<id>`. The Flask app additionally serves the `templates/index.html` dashboard at `/`.

## Security note
`config/tests.json` is operational state that can hold **real bearer tokens / JWTs and live target URLs**. Treat it as secret — do not commit real credentials to version control (`.gitignore` covers `config/*.local.json` but not `config/tests.json` itself).
