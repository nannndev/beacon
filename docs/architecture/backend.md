# Backend architecture

Beacon uses a single FastAPI backend. Code is organized by responsibility so HTTP concerns, application workflows, and request execution do not grow into one module.

## Dependency direction

```text
routers -> services -> core
   |          |
   +------> state/history/sharing
```

- `routers/` owns FastAPI request validation, status codes, and response shaping.
- `services/` owns reusable application workflows such as runner callbacks, imports, notifications, and project sharing.
- `core/` owns endpoint models and HTTP execution mechanics. It must not import FastAPI or UI concepts.
- `state.py`, history, and sharing persistence own runtime or durable application data.

## Execution core

`APITester` in `core/tester.py` is the stable orchestration facade used by REST and MCP callers. Its collaborators have one focused job:

- `models.py`: persisted endpoint and test configuration contracts.
- `templating.py`: static variables and fresh-per-request generators.
- `transport.py`: request construction for JSON, form, multipart, raw, and web targets.
- `assertions.py`: response assertion evaluation.
- `extractors.py`: response and cookie extraction into runtime variables.
- `metrics.py`: run counters, latency distributions, and snapshots.

New execution behavior should go into the narrowest collaborator that owns it. Traffic-mode orchestration stays in `APITester`; HTTP lifecycle and run registry behavior belongs in services rather than the core.

`services/run_coordinator.py` owns the asynchronous lifecycle for a single endpoint run: registering runtime state, wiring callbacks, recording history, selecting the terminal state, and sending best-effort notifications. The `/run` router remains responsible only for HTTP input validation and selecting the endpoint.

## Compatibility and testing

The public imports remain available from `app.core` and `app.core.tester`. Characterization coverage in `backend/tests/test_core_contracts.py` protects model serialization, templating, and transport contracts during further refactoring.

Run the backend suite from the repository root:

```bash
PYTHONPATH="$PWD" backend/.venv/bin/python -m pytest -q backend/tests
```

The desktop backend must also be packaged after dependency or module-boundary changes:

```bash
cd frontend
BEACON_PYTHON=../backend/.venv/bin/python npm run desktop:prepare
```
