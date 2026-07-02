# Development

## Project Structure

```
security-tools/
├── backend/           # FastAPI Python backend
├── frontend/          # React + Vite + Tauri
│   ├── src-tauri/     # Tauri desktop configuration
│   └── ...
├── docs/              # VitePress documentation (this site)
└── package.json
```

## Running Locally

```bash
npm run dev
```

This starts both backend and frontend with hot reload.

## Building Desktop

See [Desktop](/desktop) page.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + shadcn/ui + Tailwind
- **Backend**: FastAPI + Python
- **Desktop**: Tauri v2
- **Docs**: VitePress

## Key Architectural Decisions

- Folders are stored as recursive `items` (Postman style)
- Backend is separate from frontend (even in desktop via sidecar)
- All dynamic values use `{{variable}}` syntax

## Contributing

Pull requests are welcome. Please open an issue first for major changes.
