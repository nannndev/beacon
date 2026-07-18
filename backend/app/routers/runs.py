import os
import threading

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException

from ..core.tester import APITester
from ..state import store
from ..services import runner

router = APIRouter(tags=["runs"])


@router.post("/run")
async def start_run(data: dict):
    if not isinstance(data, dict) or not data.get("test_id"):
        raise HTTPException(status_code=400, detail="Missing required field: test_id")
    test_id = data["test_id"]
    test = next((t for t in store.current_config.tests if t.id == test_id), None)
    if not test:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    try:
        concurrency = int(data.get("concurrency", 1))
        delay = float(data.get("delay", 0.1))
        max_requests = int(data.get("max_requests", 100))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="concurrency/delay/max_requests must be numbers")
    use_min_delay = data.get("use_min_delay", False)

    # --- Mode selection ---
    mode = str(data.get("mode", "load")).lower().strip()

    # Build mode-specific params dict with sensible defaults drawn from the
    # request body.  Common keys (concurrency, delay, max_requests) are
    # forwarded into every mode so callers only need to set them once.
    params: dict = {
        # shared / common
        "concurrency": concurrency,
        "delay": delay if not use_min_delay else 0.001,
        "max_requests": max_requests,
        # ramp
        "ramp_start": int(data.get("ramp_start", 1)),
        "ramp_end": int(data.get("ramp_end", 16)),
        "ramp_step_duration": float(data.get("ramp_step_duration", 10.0)),
        # spike
        "baseline_workers": int(data.get("baseline_workers", 2)),
        "peak_workers": int(data.get("peak_workers", 20)),
        "baseline_requests": int(data.get("baseline_requests", 50)),
        "peak_requests": int(data.get("peak_requests", 200)),
        "recovery_requests": int(data.get("recovery_requests", 50)),
        # soak
        "duration_s": float(data.get("duration_s", 300.0)),
        "rps": float(data.get("rps", 5.0)),
        # rate_probe
        "start_rps": float(data.get("start_rps", 1.0)),
        "step_rps": float(data.get("step_rps", 1.0)),
        "step_requests": int(data.get("step_requests", 20)),
        "max_rps": float(data.get("max_rps", 100.0)),
        # fuzz
        "fuzz_fields": data.get("fuzz_fields") or {},
        "fuzz_types": data.get("fuzz_types") or {},
        # benchmark
        "n_samples": int(data.get("n_samples", 100)),
        "warmup": int(data.get("warmup", 10)),
    }

    run_id = str(os.urandom(8).hex())
    store.current_runs[run_id] = {
        "status": "running",
        "mode": mode,
        "logs": [],
        "responses": [],
        "stats": {"attempts": 0, "success": 0, "rate_limited": 0, "errors": 0},
        "stop_flag": {"stop": False},
    }

    def run_in_thread():
        try:
            tester = APITester(
                test, store.current_config,
                concurrency=concurrency,
                delay=delay if not use_min_delay else 0.001,
                max_requests=max_requests,
                log_callback=lambda m: runner.dispatch(runner.broadcast_log(run_id, m)),
                stats_callback=lambda s: runner.dispatch(runner.broadcast_stats(run_id, s)),
                response_callback=lambda r: runner.dispatch(runner.broadcast_response(run_id, r)),
                stop_flag=store.current_runs[run_id]["stop_flag"],
            )
            results = tester.run_mode(mode, params)
            # NOTE: extractor-refreshed variables live in current_config in
            # memory (used by chained runs this session). We deliberately do
            # NOT store.save() here — a background thread writing the whole
            # config races with concurrent request handlers and can clobber
            # edits made during a run.
            runner.dispatch(runner.broadcast_log(run_id, f"Finished: {results}"))
        except Exception as e:
            runner.dispatch(runner.broadcast_log(run_id, f"Error: {e}"))
        finally:
            if store.current_runs[run_id]["status"] == "running":
                store.current_runs[run_id]["status"] = "finished"
            runner.dispatch(runner.broadcast_log(run_id, "run_finished"))
            runner.dispatch(runner.broadcast_stats(run_id, store.current_runs[run_id]["stats"]))

    threading.Thread(target=run_in_thread, daemon=True).start()
    return {"run_id": run_id, "mode": mode}


@router.post("/send")
def send_single(data: dict):
    """Fire ONE request synchronously and return the full response (status,
    headers, body, timing) for inspection. Runs extractors on 2xx like a run,
    so 'Send login' refreshes tokens for the next call."""
    if not isinstance(data, dict) or not data.get("test_id"):
        raise HTTPException(status_code=400, detail="Missing required field: test_id")
    test = next((t for t in store.current_config.tests if t.id == data["test_id"]), None)
    if not test:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    try:
        retries = int(data.get("retries", 0))
        retry_delay = float(data.get("retry_delay", 0.0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="retries/retry_delay must be numbers")
    result = APITester(test, store.current_config).send_once(retries=retries, retry_delay=retry_delay)
    # Persist variables refreshed by extractors so the token survives for the
    # next Send / run and a reload. Only when something actually changed.
    if result.get("extracted"):
        store.save()
    return result


def _scenario_step(test, result: dict) -> dict:
    """Compact per-step summary for a scenario run (no full bodies)."""
    step = {
        "test_id": test.id,
        "name": test.name,
        "ok": bool(result.get("ok")),
        "status": result.get("status"),
        "time_ms": result.get("time_ms"),
        "passed": result.get("passed"),
        "extracted": result.get("extracted") or [],
        "attempts": result.get("attempts"),
    }
    if not result.get("ok"):
        step["error"] = result.get("error")
    return step


def _step_succeeded(result: dict) -> bool:
    """A scenario step passes when it got a response, no assertion failed, and
    the status is < 400."""
    if not result.get("ok"):
        return False
    if result.get("passed") is False:
        return False
    status = result.get("status")
    return status is None or status < 400


@router.post("/scenario")
def run_scenario(data: dict):
    """Run a sequence of endpoints in order as one flow (login -> use token ->
    ...). Each step is a single send; variables refreshed by extractors carry
    into later steps. Stops at the first failed step unless continue_on_error."""
    ids = data.get("test_ids")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="test_ids must be a non-empty list")
    cont = bool(data.get("continue_on_error", False))
    try:
        retries = int(data.get("retries", 0))
        retry_delay = float(data.get("retry_delay", 0.0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="retries/retry_delay must be numbers")

    by_id = {t.id: t for t in store.current_config.tests}
    steps = []
    changed = False
    for tid in ids:
        test = by_id.get(tid)
        if not test:
            steps.append({"test_id": tid, "name": None, "ok": False, "success": False, "error": "Endpoint not found"})
            if not cont:
                break
            continue
        result = APITester(test, store.current_config).send_once(retries=retries, retry_delay=retry_delay)
        if result.get("extracted"):
            changed = True
        step = _scenario_step(test, result)
        step["success"] = _step_succeeded(result)  # got a response AND status<400 AND no failed assertion
        steps.append(step)
        if not step["success"] and not cont:
            break
    if changed:
        store.save()  # persist tokens refreshed along the chain
    return {"steps": steps, "passed": bool(steps) and all(s.get("success") for s in steps),
            "completed": len(steps), "total": len(ids)}


@router.post("/stop/{run_id}")
def stop_run(run_id: str):
    if run_id in store.current_runs:
        store.current_runs[run_id]["stop_flag"]["stop"] = True
        store.current_runs[run_id]["status"] = "stopped"
    return {"status": "stopping"}


@router.get("/status/{run_id}")
def get_status(run_id: str):
    if run_id not in store.current_runs:
        raise HTTPException(status_code=404, detail="Run not found")
    run = store.current_runs[run_id]
    return {
        "status": run["status"],
        "stats": run["stats"],
        "logs": run["logs"][-100:],
        "responses": run.get("responses", [])[-100:],
    }


@router.websocket("/ws")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    store.active_websockets.append(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        if websocket in store.active_websockets:
            store.active_websockets.remove(websocket)
