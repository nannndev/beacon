# Changelog

All notable changes to Beacon are documented here. Version numbers match the
tags and installers published in [GitHub Releases](https://github.com/nannndev/beacon/releases).

## [0.3.1] - 2026-07-21

### Added

- In-app auto-updater: Beacon checks for new releases on launch and offers a one-click download, install, and relaunch (Windows).
- Native "run finished" OS notifications so long soak, benchmark, and load runs surface their results while Beacon is in the background.
- Shareable run reports: export any run from Run History as a self-contained HTML or Markdown report suitable for handing off as evidence.

[Compare 0.3.0 → 0.3.1](https://github.com/nannndev/beacon/compare/v0.3.0...v0.3.1)

## [0.3.0] - 2026-07-20

### Added

- Web Page targets for HTTP document load testing with safe GET presets.
- Single-send website metadata for TTFB, response size, redirects, content type, and final URL.
- Clear product guidance distinguishing high-rate HTTP page tests from full browser journeys.

### Changed

- Compacted the desktop sidebar into a denser 256px utility rail with clearer project, environment, and run-action hierarchy.
- Replaced native browser confirmations with an accessible in-app modal for destructive actions and multi-endpoint runs.

[Compare 0.2.4 → 0.3.0](https://github.com/nannndev/beacon/compare/v0.2.4...v0.3.0)

## [0.2.4] - 2026-07-19

### Added

- Apple Silicon macOS release as an unsigned `.dmg` alongside the Windows x64 installer.
- A 47-request JSONPlaceholder sample workspace, organized into 21 folders for safe first-run exploration.
- Local SQLite run history with search, status and mode filters, pinning, export, two-run comparison, and interrupted-run recovery.
- GitHub Pages deployment for the documentation site.

### Changed

- Desktop startup now waits for the bundled backend and initial project data before showing the workspace.
- New desktop installs initialize the default sample project consistently instead of rendering an empty or late-loading project.
- Release notes and download guidance now cover both Windows and macOS.

### Fixed

- Fixed the first-run race that could show a load error, then inject the default project after opening the new-endpoint form.
- Fixed **Run All** in Test Mode so the selected mode and request controls are sent with the correct endpoint identifiers.

[Compare 0.2.3 → 0.2.4](https://github.com/nannndev/beacon/compare/v0.2.3...v0.2.4)

## [0.2.3] - 2026-07-19

### Fixed

- Disabled automatic DevTools opening in packaged desktop builds while preserving it for development.

[Compare 0.2.2 → 0.2.3](https://github.com/nannndev/beacon/compare/v0.2.2...v0.2.3)

## [0.2.2] - 2026-07-19

### Added

- Dedicated Contributor Portal and community standards.
- Contributor recognition on the public landing experience.

### Changed

- Expanded Test Mode controls for fixed load, rate, ramp, spike, soak, rate-probe, fuzz, benchmark, and scenario workflows.
- Improved the live monitor with clearer run configuration, latency, throughput, success, error, and rate-limit feedback.

[Compare 0.2.1 → 0.2.2](https://github.com/nannndev/beacon/compare/v0.2.1...v0.2.2)

## [0.2.1] - 2026-07-19

### Added

- Windows x64 NSIS distribution through GitHub Releases.
- Bundled FastAPI backend and MCP server sidecars, so desktop users do not need Python.
- One-click MCP registration for Claude Desktop and Claude Code, plus a reusable stdio configuration snippet.
- Landing-page download flow for the packaged desktop application.

### Changed

- Desktop sidecars are staged to a stable per-user location so MCP registrations survive app updates.
- Configuration writes are serialized and protected by single-instance handling.

[Compare 0.2.0 → 0.2.1](https://github.com/nannndev/beacon/compare/v0.2.0...v0.2.1)

## [0.2.0] - 2026-07-07

### Added

- Single-send request builder and structured response inspector.
- Assertions for status, time, body content, JSON fields, and headers.
- Ordered scenarios with extractors, retries, and continue-on-error controls.
- JSON, form, multipart, and raw request bodies.
- Live latency trends and expanded MCP tools for editing, sending, and running Beacon endpoints.

## [0.1.0] - 2026-07-03

### Added

- Initial React, FastAPI, and Tauri application.
- Projects, environments, nested endpoint collections, import/export, dynamic variables, and concurrent API test execution.
