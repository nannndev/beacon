# Changelog

All notable changes to Beacon will be documented in this file.

## [1.3.0] - 2026-07-02

### Added
- Full VitePress documentation site (`docs/`)
- Proper versioning and detailed changelog
- Link to Documentation from the landing page

### Changed
- Improved documentation structure and completeness

## [1.2.0] - 2026-07-02

### Added
- Full nested folder support (Postman-style organization)
- Postman collection import that preserves folder structure
- Collapse All / Expand All for folders
- Statistics panel in the endpoint list
- "Run Folder" (recursively runs all endpoints in a folder + subfolders)
- Two-column responsive layout (endpoint tree + statistics/features)
- Desktop support using **Tauri** + Python backend as sidecar
- Automated desktop build command: `npm run desktop:build`
- Single-EXE experience (backend auto-starts when launching the desktop app)

### Changed
- Endpoint storage migrated from flat `tests[]` to recursive `items[]` structure
- Significantly modernized landing page design

## [1.1.0] - 2026-06

### Added
- Dynamic variable generators (`{{random_email}}`, `{{uuid}}`, `{{timestamp}}`, `{{random_string:12}}`, etc.)
- Response extractors for token chaining and dependent requests
- Real-time Live Monitoring dashboard
- Rate limit detection (HTTP 429 + text heuristics)
- Concurrent execution with customizable concurrency, delay, and max requests

## [1.0.0] - 2026-05

### Added
- Project and Environment management
- Endpoint CRUD (JSON, Form, Multipart)
- Basic execution engine
- Web interface (React + Vite + FastAPI)
- Portable project export/import (JSON)
- Initial variable templating support
