# Installation

## Web Application

### Recommended (from project root)

```bash
npm install
npm run dev
```

This starts both the FastAPI backend and the React frontend together.

### Manual

**Backend only:**
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

**Frontend only:**
```bash
cd frontend
npm install
npm run dev
```

## Desktop Application (Tauri)

The desktop version bundles the React frontend with a native backend sidecar.

### Prerequisites

- Rust (install from https://rustup.rs/)
- Node.js + pnpm
- Python 3.10+

### Build Steps

```bash
# 1. Build the Python backend as a sidecar
cd backend
pip install pyinstaller
python build_backend.py

# 2. Copy the binary (Windows example)
copy dist\backend.exe ..\frontend\src-tauri\backend.exe

# 3. Build the desktop app
cd ../frontend
npm run desktop:build
```

The final executable will be located in:

`frontend/src-tauri/target/release/`

## Development Scripts

From the root:

| Command                | Description                              |
|------------------------|------------------------------------------|
| `npm run dev`          | Run backend + frontend together          |
| `npm run desktop:build`| Build the full desktop application       |
| `npm run docs:dev`     | Start VitePress documentation locally    |

Next: [Folders & Organization](./features/folders.md)
