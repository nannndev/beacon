# Changelog

All notable changes to Beacon are documented here. Version numbers match the
tags and installers published in [GitHub Releases](https://github.com/nannndev/beacon/releases).

## [0.4.6] - 2026-07-29

### Added

- Multi-format project import for Beacon exports, Postman, OpenAPI 3, Swagger 2, Insomnia, HAR, JSON, and YAML, with the same preview and validation pipeline across Desktop and MCP.
- MCP endpoint search with pagination and endpoint preflight diagnostics for resolved URLs, missing variables, and redacted sensitive headers.
- Focused chart inspection with expandable operations charts and clearer time-range presentation.
- Characterization coverage for the execution core, project importer, and MCP tool contracts.

### Improved

- Split the request engine into focused model, templating, transport, assertion, extraction, and metrics modules while preserving the existing REST and MCP contracts.
- Moved asynchronous endpoint-run lifecycle, history recording, terminal states, and notifications out of the HTTP router into a dedicated coordinator service.
- MCP responses now use context-safe body limits, structured error codes, strict run-parameter validation, and production import normalization.
- Updated the Beacon agent skill with paginated discovery, endpoint preflight, extractor-aware scenarios, safe traffic escalation, and actionable MCP error recovery.

### Fixed

- Imported MCP requests now receive collision-free endpoint and folder IDs instead of creating incomplete tree nodes.
- Creating an endpoint with an unknown MCP folder no longer silently places it at the project root.
- Plain-text cURL request bodies imported through MCP now use the raw payload type instead of being wrapped as JSON.
- Frozen MCP binaries now shut down cleanly after a normal stdio client disconnect without emitting a misleading closed-file traceback.
- Removed the unused duplicate legacy request engine that could drift from the maintained backend implementation.

[Compare 0.4.5 → 0.4.6](https://github.com/nannndev/beacon/compare/v0.4.5...v0.4.6)

## [0.4.5] - 2026-07-28

### Added

- Live Scenario progress for selected API endpoints, Web document requests, and multi-step project journeys.
- Per-step execution states, active virtual-user counts, request progress, throughput, average latency, P95 latency, and recent activity events.
- Structured failure explanations for transport errors, timeouts, HTTP failures, assertion mismatches, missing endpoints, and failure-threshold stops.
- A scrollable activity feed with Follow, Pause, and Jump to latest controls.
- A current-release changelog section on the Beacon landing page.

### Improved

- Scenario controls now distinguish selected-endpoint requests from full project journeys and explain how Web targets measure HTTP document loading rather than browser rendering.
- The Scenario monitor uses previously empty space for useful live signals and keeps up to 100 recent execution events available for inspection.
- Landing-page copy is shorter, more direct, and less formal across the product, sharing, workflow, MCP, desktop, contributor, and support sections.

### Fixed

- Opening the Scenario monitor no longer crashes the React tree because of a conditional Hooks-order violation.
- Desktop development builds now expose the same live Scenario status contract as the frontend after rebuilding the bundled backend sidecar.
- Scenario runs no longer appear to jump directly to Passed while work is still executing when the current backend is installed.

[Compare 0.4.4 → 0.4.5](https://github.com/nannndev/beacon/compare/v0.4.4...v0.4.5)

## [0.4.4] - 2026-07-27

### Added

- Encrypted local project sharing over HTTPS with a persistent per-device identity and visible SHA-256 fingerprint.
- Trusted-device reconnect, stable sharing ports, automatic LAN rediscovery, live revision events, presence, and active endpoint indicators.
- Three-way source merging with automatic non-overlapping merges and per-field conflict resolution.
- Granular sharing activity attribution with device name, device ID, IP address, revision, and safe change summaries.
- Sharing protocol compatibility metadata and clear update-required states for incompatible Beacon versions.

### Improved

- Project sharing now distinguishes connected, offline, access-expired, read-only, conflict, and host-identity-changed states.
- Owners can inspect and manage trusted devices even when a member has no active session.
- Certificate fingerprints are pinned on the same HTTPS connection carrying each request, preventing source transmission when host identity changes.

### Fixed

- Shared projects reconnect after the host restarts without requiring a new pairing code.
- Joined devices can rediscover a trusted host when its LAN address changes.
- Concurrent edits no longer overwrite unrelated teammate changes.

[Compare 0.4.3 → 0.4.4](https://github.com/nannndev/beacon/compare/v0.4.3...v0.4.4)

## [0.4.3] - 2026-07-27

### Fixed

- Windows in-app updates now download completely before Beacon stops its backend sidecar and starts installation.
- The updater explicitly terminates the backend process tree before replacing packaged files, preventing a locked old `backend.exe` from surviving beside a newer frontend.
- Installation failures remain failures and instruct the user to restart before retrying instead of presenting a partially updated app as ready.

[Compare 0.4.2 → 0.4.3](https://github.com/nannndev/beacon/compare/v0.4.2...v0.4.3)

## [0.4.2] - 2026-07-27

### Fixed

- Added an explicit frontend/backend compatibility handshake so an outdated Windows sidecar is reported as a version mismatch instead of a generic `Not Found` error.
- Windows release validation now checks the packaged backend for both Scenario and Sharing routes before publishing an installer.
- Internal Beacon route errors are now distinguished from HTTP 404 responses returned by the API target being tested.

### Added

- Owners can change a connected member between Viewer and Editor or revoke access.
- Members can preserve the latest synchronized snapshot as a private project or leave a shared project.
- The landing page now explains local-first project sharing, device roles, revisioned source, local execution, and private data boundaries.

[Compare 0.4.1 → 0.4.2](https://github.com/nannndev/beacon/compare/v0.4.1...v0.4.2)

## [0.4.1] - 2026-07-27

### Fixed

- Enabled the opt-in LAN sharing host in packaged Windows, macOS, and Linux builds. Version 0.4.0 exposed the sharing controls but only started the listener in debug builds, causing Share and Join to fail in the installed app.

### Security

- Local sharing still requires an expiring pairing code, explicit approval by the project owner, and a Viewer or Editor role. Use it only on a trusted local network while encrypted transport is under development.

[Compare 0.4.0 → 0.4.1](https://github.com/nannndev/beacon/compare/v0.4.0...v0.4.1)

## [0.4.0] - 2026-07-27

### Added

- Local-first project sharing foundation with revisioned SQLite snapshots and project-scoped source synchronization.
- LAN pairing with expiring codes, explicit owner approval, and Viewer or Editor roles.
- Automatic revision polling and Editor mutation sync between paired Beacon devices.
- A dedicated Project Settings screen showing the host address, shared project, revision, connected devices, pending approvals, member role, and connection state.

### Improved

- Project sharing keeps requests, responses, run history, notification credentials, and private environment values on each device.
- Joined projects clearly distinguish read-only Viewer access from editable Editor access.
- Repository language statistics no longer include generated Graphify reports.

### Security

- Public release builds keep insecure LAN hosting disabled while encrypted transport is under development; the current LAN host is available only in desktop debug builds.

[Compare 0.3.9 → 0.4.0](https://github.com/nannndev/beacon/compare/v0.3.9...v0.4.0)

## [0.3.9] - 2026-07-25

### Added

- Cancellable asynchronous Scenario runs with a responsive Stop action and explicit stopped results.
- Separate Scenario actions for one selected API/Web endpoint and the full project journey.
- Beginner-friendly explanations and request estimates for virtual users, iterations, ramp-up, think time, retries, and failure limits.
- A Local Project Sharing technical design covering project-scoped LAN synchronization, revision history, private variables, roles, conflicts, and a cloud-compatible protocol.

### Improved

- Scenario workers now use a bounded pool and interruptible waits so large virtual-user configurations remain controllable.
- The desktop and landing visual systems now use a consistent Electric Blue accent and meaningful request/response trace backgrounds.
- The landing page uses a refined liquid-glass material, updated product screenshots, a current Run History capture, and refreshed feature banners.
- README product images and scenario descriptions now match the current desktop application.

### Fixed

- Stopped Scenario runs no longer report as passed or remain stuck in an incorrect running state.
- Scenario completion now requires every intended step or journey to finish successfully.
- Run status polling now returns the final Scenario result to the desktop UI.

[Compare 0.3.8 → 0.3.9](https://github.com/nannndev/beacon/compare/v0.3.8...v0.3.9)

## [0.3.8] - 2026-07-25

### Fixed

- Scenario runs once again execute the complete project journey in endpoint-list order, preserving authentication and extracted-token steps before protected requests.
- Removed the ambiguous single-endpoint Scenario action that could finish instantly or return `403` after skipping the login step.
- Scenario controls now show the exact project endpoint count; folder-only journeys remain available through each folder's Chain action.

[Compare 0.3.7 → 0.3.8](https://github.com/nannndev/beacon/compare/v0.3.7...v0.3.8)

## [0.3.7] - 2026-07-25

### Added

- Capacity testing that increases traffic until latency, error-rate, or success-rate limits are breached, then reports the last safe throughput.
- Virtual-user Scenario testing with iterations, ramp-up, think time, retries, isolated variables, and beginner-friendly traffic presets.
- An inline Scenario journey monitor showing the running state, elapsed time, execution scope, endpoint path, per-step results, and bottlenecks without a modal.
- Expandable live test charts, richer response-outcome metrics, and focused chart inspection.
- Linux desktop packaging for `.deb` and AppImage alongside Windows and macOS releases.

### Improved

- Test-mode values now persist independently across mode switches and app restarts, with a one-click reset to recommended defaults.
- Scenario actions now clearly distinguish the selected endpoint, the entire project journey, and folder-only chains.
- Response assertions have clearer visual summaries, collapsible JSON keys, and clipboard shortcuts.
- Export and download actions now show progress and completion feedback.
- Run History has improved filtering, details, comparisons, and chart metrics.

### Fixed

- Scenario `Run` no longer silently executes every endpoint while displaying the selected endpoint as its target.
- Endpoint, folder, and project reordering now preserves the dropped order reliably.
- Desktop release validation now verifies Windows, macOS, and Linux artifacts before publishing.

[Compare 0.3.6 → 0.3.7](https://github.com/nannndev/beacon/compare/v0.3.6...v0.3.7)

## [0.3.6] - 2026-07-24

### Improved

- Environments can be duplicated and moved between projects using JSON import/export.
- Sensitive-looking environment values are masked by default and can be revealed individually.
- Endpoint URLs now preview resolved environment variables and call out missing variables before a request is sent.
- Assertions now include common presets, typed expected values, and clearer expected-versus-actual failure messages.
- Endpoints can now be sent once directly from the endpoint list, with the full response inspector shown in place—no editor detour required.
- Response JSON values can be captured into the active environment in one step; Beacon saves the current value immediately and keeps an extractor attached for future sends.
- The environment editor now stays usable on small screens and with long variable lists.

### Fixed

- Aptabase events are now allowed through the Tauri capability used by release builds; development builds also log rejected tracking calls for diagnosis.

[Compare 0.3.5 → 0.3.6](https://github.com/nannndev/beacon/compare/v0.3.5...v0.3.6)

## [0.3.5] - 2026-07-23

### Fixed

- Usage analytics now reliably record from release builds — buffered events are flushed when the app closes, so short sessions are no longer lost.

### Docs

- The download page and release notes now explain the macOS first-run step (clearing Gatekeeper quarantine on the unsigned build).

[Compare 0.3.4 → 0.3.5](https://github.com/nannndev/beacon/compare/v0.3.4...v0.3.5)

## [0.3.4] - 2026-07-22

### Fixed

- Anonymous usage analytics now record on macOS. Events are sent natively instead of from the webview, which macOS was silently blocking; they also carry the correct OS and app version now.
- macOS auto-update is wired up correctly — the update manifest now includes the macOS build.

[Compare 0.3.3 → 0.3.4](https://github.com/nannndev/beacon/compare/v0.3.3...v0.3.4)

## [0.3.3] - 2026-07-22

### Added

- Command palette (Cmd/Ctrl+K) and Cmd/Ctrl+Enter to send a request.
- Copy any request as a ready-to-run `curl` command.
- System theme option that follows your OS.
- Dedicated MCP page with a browser of every tool your AI agent can drive, plus per-client setup cards.
- Anonymous, opt-out usage analytics (no URLs, payloads, or tokens).
- Live latency/throughput chart now shows numeric axes and a stats readout.
- One-click "Download" on the site now fetches the right installer for your OS directly.

### Changed

- Redesigned the update experience as a clear modal (available / downloading / restart), with a lightweight toast for "up to date".
- MCP server can now create and switch projects, and the dashboard reflects endpoints created over MCP without a reload.
- Smoother animations: sliding sidebar, fluid section collapse, page-transition fades.

### Fixed

- Endpoints created via MCP now appear in the dashboard (backend reloads shared state from disk).
- The macOS auto-update artifact is now published, and the release announcement posts to Discord reliably.
- Settings and MCP entry points no longer disappear in non-desktop builds.

[Compare 0.3.2 → 0.3.3](https://github.com/nannndev/beacon/compare/v0.3.2...v0.3.3)

## [0.3.2] - 2026-07-22

### Added

- Per-project Discord notifications: post a run summary to a channel via a webhook, always or only on failure.
- Command palette (Cmd/Ctrl+K) for quick actions, and Cmd/Ctrl+Enter to send a request.
- Copy any request as a ready-to-run `curl` command.
- Global Settings with a System theme option that follows your OS, plus a dedicated MCP page listing every tool your AI agent can drive.
- macOS in-app auto-update (the release now publishes a signed macOS updater artifact).

### Changed

- Live run view no longer freezes at high request rates: updates are batched and the log list is virtualized.
- Run History recovers on its own from transient database locks instead of staying unavailable, and a reset never deletes data (the old database is kept as a timestamped backup).
- Smoother UI: the sidebar now glides open/closed, sections collapse fluidly, and page changes fade.

### Fixed

- Claude Code now detects correctly on the MCP screen (previously always showed "CLI not installed").

[Compare 0.3.1 → 0.3.2](https://github.com/nannndev/beacon/compare/v0.3.1...v0.3.2)

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
