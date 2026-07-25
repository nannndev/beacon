import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException

from ..core.tester import APITester, TestConfig
from ..history.models import RunStart, RunStepStart
from ..history.sanitize import sanitize_run_config
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
        # capacity SLO
        "p95_limit_ms": float(data.get("p95_limit_ms", 500.0)),
        "error_limit_pct": float(data.get("error_limit_pct", 1.0)),
        "success_min_pct": float(data.get("success_min_pct", 99.0)),
        # fuzz
        "fuzz_fields": data.get("fuzz_fields") or {},
        "fuzz_types": data.get("fuzz_types") or {},
        # benchmark
        "n_samples": int(data.get("n_samples", 100)),
        "warmup": int(data.get("warmup", 10)),
    }

    run_id = str(os.urandom(8).hex())
    history_id = str(data.get("history_id") or run_id)
    try:
        history_step_index = int(data.get("history_step_index", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="history_step_index must be a number")
    is_history_group = bool(data.get("history_id"))
    notif_settings: dict = {}
    notif_project_name = None
    if not is_history_group:
        active_project = next(
            (p for p in store.projects if p.get("id") == store.current_project_id),
            {"id": store.current_project_id or "unknown", "name": "Unknown project"},
        )
        notif_settings = active_project.get("notifications") or {}
        notif_project_name = active_project.get("name")
        history_persisted = store.history.start(
            RunStart(
                id=history_id,
                workspace_id=store.history.workspace_id or "local",
                project_id=active_project.get("id") or "unknown",
                project_name=active_project.get("name") or "Unknown project",
                origin_device_id=store.history.origin_device_id or "local",
                source_type="endpoint",
                target_id=test.id,
                target_name=test.name,
                mode=mode,
                config_snapshot=sanitize_run_config(data, test),
            ),
            [RunStepStart(history_step_index, test.id, test.name, test.method, test.url)],
        )
    else:
        history_persisted = True
    store.current_runs[run_id] = {
        "status": "running",
        "mode": mode,
        "logs": [],
        "responses": [],
        "stats": {"attempts": 0, "success": 0, "rate_limited": 0, "errors": 0},
        "stop_flag": {"stop": False},
    }

    def run_in_thread():
        outcome = "completed"
        try:
            def on_stats(stats):
                store.history.record_stats(history_id, history_step_index, stats)
                runner.dispatch(runner.broadcast_stats(run_id, stats))

            def on_response(response):
                store.history.record_response(history_id, history_step_index, response)
                runner.dispatch(runner.broadcast_response(run_id, response))

            tester = APITester(
                test, store.current_config,
                concurrency=concurrency,
                delay=delay if not use_min_delay else 0.001,
                max_requests=max_requests,
                log_callback=lambda m: runner.dispatch(runner.broadcast_log(run_id, m)),
                stats_callback=on_stats,
                response_callback=on_response,
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
            outcome = "failed"
            runner.dispatch(runner.broadcast_log(run_id, f"Error: {e}"))
        finally:
            if store.current_runs[run_id]["stop_flag"].get("stop"):
                outcome = "stopped"
            store.history.finish_step(history_id, history_step_index, outcome)
            if not is_history_group:
                store.history.finish_run(history_id, outcome)
            if outcome == "stopped":
                store.current_runs[run_id]["status"] = "stopped"
            elif store.current_runs[run_id]["status"] == "running":
                store.current_runs[run_id]["status"] = "finished"
            runner.dispatch(runner.broadcast_log(run_id, "run_finished"))
            runner.dispatch(runner.broadcast_stats(run_id, store.current_runs[run_id]["stats"]))
            # Best-effort Discord notification for a finished standalone run.
            # Scenario/folder groups notify at their own coordination layer.
            if not is_history_group and notif_settings:
                try:
                    from ..services.notify_discord import maybe_notify
                    maybe_notify(
                        notif_settings,
                        target_name=test.name,
                        mode=mode,
                        stats=store.current_runs[run_id]["stats"],
                        outcome=outcome,
                        project_name=notif_project_name,
                    )
                except Exception:
                    pass

    threading.Thread(target=run_in_thread, daemon=True).start()
    return {"run_id": run_id, "mode": mode,
            "history_id": history_id if history_persisted else None}


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
    # `_stop_flag` is supplied only by the asynchronous /scenario/start
    # wrapper. Keeping the executor here also preserves the synchronous route
    # for older clients and MCP integrations.
    external_stop_flag = data.get("_stop_flag") or {"stop": False}
    ids = data.get("test_ids")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="test_ids must be a non-empty list")
    cont = bool(data.get("continue_on_error", False))
    try:
        retries = int(data.get("retries", 0))
        retry_delay = float(data.get("retry_delay", 0.0))
        virtual_users = max(1, int(data.get("virtual_users", 1)))
        iterations = max(1, int(data.get("iterations", 1)))
        ramp_up_s = max(0.0, float(data.get("ramp_up_s", 0.0)))
        think_time_s = max(0.0, float(data.get("think_time_ms", 0.0)) / 1000.0)
        stop_failure_pct = min(100.0, max(0.0, float(data.get("stop_failure_pct", 100.0))))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="scenario settings must be numbers")

    by_id = {t.id: t for t in store.current_config.tests}
    history_id = str(os.urandom(8).hex())
    active_project = next(
        (p for p in store.projects if p.get("id") == store.current_project_id),
        {"id": store.current_project_id or "unknown", "name": "Unknown project"},
    )
    history_steps = [
        RunStepStart(index, by_id[tid].id, by_id[tid].name, by_id[tid].method, by_id[tid].url)
        for index, tid in enumerate(ids)
        if tid in by_id
    ]
    store.history.start(
        RunStart(
            id=history_id,
            workspace_id=store.history.workspace_id or "local",
            project_id=active_project.get("id") or "unknown",
            project_name=active_project.get("name") or "Unknown project",
            origin_device_id=store.history.origin_device_id or "local",
            source_type="scenario",
            target_id=None,
            target_name=f"Scenario · {len(ids)} steps",
            mode="scenario",
            config_snapshot={
                "mode": "scenario", "virtual_users": virtual_users,
                "iterations": iterations, "ramp_up_s": ramp_up_s,
                "think_time_ms": round(think_time_s * 1000),
                "stop_failure_pct": stop_failure_pct,
            },
        ),
        history_steps,
    )

    is_virtual = virtual_users > 1 or iterations > 1
    if is_virtual:
        started = time.monotonic()
        records_by_step = [[] for _ in ids]
        completed_flows = 0
        successful_flows = 0
        stopped_early = False
        state_lock = threading.Lock()
        stop_event = threading.Event()
        base_config = store.current_config.to_dict()

        def run_virtual_user(user_index: int):
            nonlocal completed_flows, successful_flows, stopped_early
            if ramp_up_s > 0 and virtual_users > 1:
                scheduled_at = started + (user_index / (virtual_users - 1)) * ramp_up_s
                stop_event.wait(max(0.0, scheduled_at - time.monotonic()))
            user_config = TestConfig.from_dict(base_config)
            user_tests = {test.id: test for test in user_config.tests}

            for iteration_index in range(iterations):
                if stop_event.is_set() or external_stop_flag.get("stop"):
                    break
                flow_success = True
                for step_index, tid in enumerate(ids):
                    if stop_event.is_set() or external_stop_flag.get("stop"):
                        flow_success = False
                        break
                    test = user_tests.get(tid)
                    if not test:
                        result = {"ok": False, "error": "Endpoint not found", "attempts": 1}
                    else:
                        result = APITester(test, user_config).send_once(
                            retries=retries, retry_delay=retry_delay
                        )
                    succeeded = _step_succeeded(result)
                    details = _scenario_step(test, result) if test else {
                        "test_id": tid, "name": None, "ok": False,
                        "error": "Endpoint not found",
                    }
                    record = {
                        "user": user_index + 1,
                        "iteration": iteration_index + 1,
                        "success": succeeded,
                        **details,
                    }
                    with state_lock:
                        records_by_step[step_index].append(record)
                    if not succeeded:
                        flow_success = False
                        if not cont:
                            break
                    if think_time_s > 0 and step_index < len(ids) - 1:
                        stop_event.wait(think_time_s)

                with state_lock:
                    completed_flows += 1
                    if flow_success:
                        successful_flows += 1
                    failures = completed_flows - successful_flows
                    failure_pct = failures / completed_flows * 100.0
                    if completed_flows >= virtual_users and failure_pct > stop_failure_pct:
                        stopped_early = True
                        stop_event.set()

        # A large virtual-user count must not create thousands of OS threads.
        # The bounded pool still executes every virtual user while remaining
        # responsive enough for the Stop action.
        with ThreadPoolExecutor(max_workers=min(virtual_users, 64)) as executor:
            futures = [executor.submit(run_virtual_user, index) for index in range(virtual_users)]
            for future in as_completed(futures):
                future.result()

        summaries = []
        for step_index, tid in enumerate(ids):
            test = by_id.get(tid)
            records = records_by_step[step_index]
            latencies = sorted(float(r.get("time_ms") or 0) for r in records if r.get("time_ms") is not None)
            successes = sum(1 for record in records if record.get("success"))
            attempts = len(records)
            p95_index = max(0, min(len(latencies) - 1, int((len(latencies) - 1) * 0.95))) if latencies else 0
            summary = {
                "test_id": tid,
                "name": test.name if test else None,
                "ok": attempts > 0 and successes == attempts,
                "success": attempts > 0 and successes == attempts,
                "attempts": attempts,
                "successful": successes,
                "failed": attempts - successes,
                "success_rate": round(successes / attempts * 100.0, 1) if attempts else 0.0,
                "avg_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
                "p95_ms": round(latencies[p95_index], 1) if latencies else None,
                "error": next((r.get("error") for r in records if r.get("error")), None),
            }
            summaries.append(summary)
            for record in records:
                store.history.record_response(history_id, step_index, record)
            store.history.record_stats(history_id, step_index, {
                "attempts": attempts,
                "success": successes,
                "rate_limited": sum(1 for r in records if r.get("status") == 429),
                "errors": attempts - successes,
                "latency_ms": {"avg": summary["avg_ms"] or 0, "last": summary["p95_ms"] or 0},
            })
            store.history.finish_step(history_id, step_index, "completed" if summary["success"] else "failed")

        failed_flows = completed_flows - successful_flows
        success_rate = round(successful_flows / completed_flows * 100.0, 1) if completed_flows else 0.0
        stopped_by_user = bool(external_stop_flag.get("stop"))
        passed = not stopped_by_user and completed_flows == virtual_users * iterations and failed_flows == 0
        bottleneck = max(
            (summary for summary in summaries if summary.get("p95_ms") is not None),
            key=lambda summary: summary["p95_ms"], default=None,
        )
        store.history.finish_run(history_id, "stopped" if stopped_by_user else "completed" if passed else "failed")
        return {
            "steps": summaries, "passed": passed,
            "completed": len(summaries), "total": len(ids), "history_id": history_id,
            "virtual_users": virtual_users, "iterations": iterations,
            "total_flows": virtual_users * iterations,
            "completed_flows": completed_flows,
            "successful_flows": successful_flows, "failed_flows": failed_flows,
            "success_rate": success_rate,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "stopped_early": stopped_early,
            "stopped": stopped_by_user,
            "bottleneck": {"test_id": bottleneck["test_id"], "name": bottleneck["name"], "p95_ms": bottleneck["p95_ms"]} if bottleneck else None,
        }

    steps = []
    changed = False
    for step_index, tid in enumerate(ids):
        if external_stop_flag.get("stop"):
            break
        test = by_id.get(tid)
        if not test:
            steps.append({"test_id": tid, "name": None, "ok": False, "success": False, "error": "Endpoint not found"})
            if not cont:
                break
            continue
        result = APITester(test, store.current_config).send_once(retries=retries, retry_delay=retry_delay)
        store.history.record_response(history_id, step_index, result)
        if result.get("extracted"):
            changed = True
        step = _scenario_step(test, result)
        step["success"] = _step_succeeded(result)  # got a response AND status<400 AND no failed assertion
        steps.append(step)
        attempts = int(result.get("attempts") or 1)
        store.history.record_stats(history_id, step_index, {
            "attempts": attempts,
            "success": attempts if step["success"] else 0,
            "rate_limited": attempts if result.get("status") == 429 else 0,
            "errors": 0 if step["success"] else attempts,
        })
        store.history.finish_step(
            history_id, step_index, "completed" if step["success"] else "failed"
        )
        if not step["success"] and not cont:
            break
    if changed:
        store.save()  # persist tokens refreshed along the chain
    stopped_by_user = bool(external_stop_flag.get("stop"))
    passed = not stopped_by_user and len(steps) == len(ids) and all(s.get("success") for s in steps)
    store.history.finish_run(history_id, "stopped" if stopped_by_user else "completed" if passed else "failed")
    return {"steps": steps, "passed": passed,
            "completed": len(steps), "total": len(ids), "history_id": history_id,
            "stopped": stopped_by_user}


@router.post("/scenario/start")
def start_scenario(data: dict):
    """Start a cancellable scenario and return immediately with a run id."""
    run_id = str(os.urandom(8).hex())
    stop_flag = {"stop": False}
    store.current_runs[run_id] = {
        "status": "running", "mode": "scenario", "logs": [],
        "responses": [], "stats": {"attempts": 0, "success": 0, "rate_limited": 0, "errors": 0},
        "stop_flag": stop_flag, "result": None,
    }

    def run_in_thread():
        try:
            result = run_scenario({**data, "_stop_flag": stop_flag})
            store.current_runs[run_id]["result"] = result
            store.current_runs[run_id]["status"] = "stopped" if stop_flag["stop"] else "finished"
        except Exception as exc:
            store.current_runs[run_id]["result"] = {"passed": False, "error": str(exc), "steps": []}
            store.current_runs[run_id]["status"] = "failed"

    threading.Thread(target=run_in_thread, daemon=True).start()
    return {"run_id": run_id, "mode": "scenario"}


@router.post("/stop/{run_id}")
def stop_run(run_id: str):
    if run_id in store.current_runs:
        store.current_runs[run_id]["stop_flag"]["stop"] = True
        store.current_runs[run_id]["status"] = "stopping"
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
        "result": run.get("result"),
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
