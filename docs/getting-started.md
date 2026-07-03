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

1. Create a new **Project**
2. Create **Folders** to organize your endpoints (highly recommended)
3. Add your first endpoint manually or **Import from Postman**

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
