# Introduction

**Beacon** is a modern API workspace and load testing tool.

It was built for developers and security researchers who need more than a basic REST client — you need organization, dynamic data, chaining, and powerful load testing capabilities.

## Why Beacon?

Most API tools are either:

- Too simple (just send requests)
- Too bloated (heavy clients with unnecessary features)
- Not great for testing at scale

Beacon aims to be the sweet spot:

- **Postman-like organization** with proper nested folders
- **Excellent import** from Postman
- **Powerful templating** and extractors
- **Real load testing** with live monitoring
- **Desktop support** with a native app that bundles everything

## Main Features

- Nested folders for organizing endpoints
- Postman collection import (preserves folders)
- Dynamic variables (`{{random_email}}`, `{{uuid}}`, `{{timestamp}}`, custom generators)
- Response extractors for building auth chains
- Live monitoring with stats, rate limit detection, and response viewer
- Concurrent execution with configurable delay and max requests
- Desktop app via Tauri (React frontend + Python backend as sidecar)
- Portable projects (export/import as JSON)

## Tech Stack

- Frontend: React + TypeScript + Vite + shadcn/ui
- Backend: FastAPI (Python)
- Desktop: Tauri v2
- Documentation: VitePress

## Project Status

Beacon is actively developed. It already supports core workflows for API testing and load testing, including desktop usage.

Next: [Getting Started](./getting-started.md)
