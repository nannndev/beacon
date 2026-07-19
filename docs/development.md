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

Start with the [contribution guide](https://github.com/nannndev/beacon/blob/main/CONTRIBUTING.md)
for setup, safety, testing, and pull request expectations. Use the issue chooser
for bugs, documentation, design proposals, and QA reports.

Report vulnerabilities privately according to the
[security policy](https://github.com/nannndev/beacon/blob/main/SECURITY.md), and
follow the [Code of Conduct](https://github.com/nannndev/beacon/blob/main/CODE_OF_CONDUCT.md)
in every project space.
