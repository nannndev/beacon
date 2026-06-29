# Security Tools (Refactored)

**Modern scalable version** — React (TypeScript) + shadcn/ui frontend + Python FastAPI backend.

## Why this structure?

- One file HTML + big script = unmaintainable.
- Moved to proper separated frontend/backend.
- React for nice, component-based, scalable UI (full page editor, proper forms).
- FastAPI backend (more reliable WebSockets than old SocketIO on Windows).
- Core tester logic stays in Python (powerful for concurrent requests).

## Setup & Run (Recommended from ROOT)

### 1. One-time Setup
```bash
# Option A: Using pnpm (recommended)
pnpm run setup

# Option B: Windows double-click
setup.bat
```

This will:
- Install root dependencies (concurrently)
- Install frontend (pnpm)
- Install backend (pip)

### 2. Run Both Together (one command)
```bash
pnpm dev
```

Or on Windows:
```bash
start-dev.bat
```

This starts:
- **Backend**  → http://localhost:8000 (FastAPI)  — now with colored startup banner [BACKEND]
- **Frontend** → http://localhost:5173 (React + shadcn/ui)

Terminal output uses colored prefixes like:
[BACKEND]  14:23:45  Uvicorn running...
[FRONTEND] 14:23:45  VITE ready...

### Available Root Scripts

```bash
pnpm run setup          # install everything
pnpm dev                # start backend + frontend together
pnpm run dev:backend    # start only backend
pnpm run dev:frontend   # start only frontend
```

## Manual (if you prefer cd)

```bash
# Backend
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
pnpm install
pnpm dev
```

## UI Stack
- React + TypeScript + Vite
- shadcn/ui (Tailwind based, copy-paste components)
- Full page editor instead of modals
- Clean component structure for scalability

## Features
- Fully dynamic endpoints per project
- Authorization header is dynamic (Bearer or custom per endpoint)
- Random values: `{{random_string}}`, `{{random_number}}`, `{{random_phone}}`
- Extractors for refreshing tokens from responses

## Features carried over (improved):
- Fully dynamic endpoints
- Variables + {{random_string}}, {{random_number}}, {{random_phone}} etc.
- Per-endpoint Authorization (Bearer / Cookie / custom) — now properly dynamic
- Extractors for fresh tokens
- Live stats + logs

This is now much easier to extend (add history, multiple configs, auth, etc.).
