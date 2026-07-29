import os
import copy
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException

from ..core.tester import APITester, TestConfig
from ..history.models import RunStart, RunStepStart
from ..state import store
from ..services import runner
from ..services.run_coordinator import EndpointRunCoordinator

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

    try:
        history_step_index = int(data.get("history_step_index", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="history_step_index must be a number")
    coordinator = EndpointRunCoordinator(
        store,
        tester_factory=APITester,
        thread_factory=threading.Thread,
        events=runner,
    )
    return coordinator.start(
        test,
        mode=mode,
        params=params,
        request_config=data,
        history_id=data.get("history_id"),
        history_step_index=history_step_index,
    )


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
    failure = _scenario_failure(result)
    if failure:
        step["failure"] = failure
    return step


def _scenario_failure(result: dict):
    """Return a stable, UI-friendly reason without exposing response bodies."""
    if not result.get("ok"):
        message = str(result.get("error") or "Request failed")
        lowered = message.lower()
        kind = "timeout" if "timeout" in lowered or "timed out" in lowered else "transport_error"
        return {"kind": kind, "message": message}

    failed_assertions = [
        {
            "message": assertion.get("message"),
            "expected": assertion.get("expected"),
            "actual": assertion.get("actual"),
        }
        for assertion in (result.get("assertions") or [])
        if not assertion.get("ok")
    ]
    if failed_assertions:
        return {
            "kind": "assertion_failed",
            "message": failed_assertions[0].get("message") or "Response assertion failed",
            "status": result.get("status"),
            "assertion_failures": failed_assertions,
        }

    status = result.get("status")
    if status is not None and status >= 400:
        return {
            "kind": "http_error",
            "message": f"HTTP {status} returned by the endpoint",
            "status": status,
        }
    return None


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
    live_run = store.current_runs.get(data.get("_run_id")) if data.get("_run_id") else None
    live_lock = live_run.get("lock") if live_run else None
    total_flows = virtual_users * iterations

    def with_live_update(update):
        if not live_run:
            return
        if live_lock:
            with live_lock:
                update(live_run)
        else:
            update(live_run)

    def initialize_live(run):
        run["progress"] = {
            "scope": "endpoint" if len(ids) == 1 else "journey",
            "total_flows": total_flows,
            "completed_flows": 0,
            "successful_flows": 0,
            "failed_flows": 0,
            "active_users": 0,
            "requests_completed": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "rate_limited": 0,
        }
        run["scenario_steps"] = [
            {
                "test_id": tid,
                "name": by_id[tid].name if tid in by_id else None,
                "method": by_id[tid].method if tid in by_id else None,
                "state": "waiting",
                "attempts": 0,
                "successful": 0,
                "failed": 0,
                "success_rate": 0.0,
                "avg_ms": None,
                "p95_ms": None,
                "last_status": None,
                "failure": None,
                "_latencies": [],
            }
            for tid in ids
        ]
        run["recent_events"] = []

    def record_live_step(step_index, record):
        def update(run):
            progress = run["progress"]
            step = run["scenario_steps"][step_index]
            succeeded = bool(record.get("success"))
            step["attempts"] += 1
            step["successful"] += 1 if succeeded else 0
            step["failed"] += 0 if succeeded else 1
            step["success_rate"] = round(step["successful"] / step["attempts"] * 100.0, 1)
            step["last_status"] = record.get("status")
            latency = record.get("time_ms")
            if latency is not None:
                step["_latencies"].append(float(latency))
                values = sorted(step["_latencies"])
                step["avg_ms"] = round(sum(values) / len(values), 1)
                step["p95_ms"] = round(values[max(0, int((len(values) - 1) * 0.95))], 1)
            failure = record.get("failure")
            if failure:
                step["failure"] = failure
            step["state"] = "failed" if step["failed"] else "running"
            progress["requests_completed"] += 1
            progress["successful_requests"] += 1 if succeeded else 0
            progress["failed_requests"] += 0 if succeeded else 1
            progress["rate_limited"] += 1 if record.get("status") == 429 else 0
            event = {
                "at_ms": int(time.time() * 1000),
                "step_index": step_index,
                "test_id": record.get("test_id"),
                "name": record.get("name"),
                "method": by_id.get(record.get("test_id")).method if by_id.get(record.get("test_id")) else None,
                "user": record.get("user", 1),
                "iteration": record.get("iteration", 1),
                "state": "passed" if succeeded else "failed",
                "status": record.get("status"),
                "time_ms": record.get("time_ms"),
                "attempts": record.get("attempts"),
                "extracted": record.get("extracted") or [],
                "failure": failure,
            }
            run["recent_events"] = (run["recent_events"] + [event])[-100:]
        with_live_update(update)

    def record_live_flow(flow_success):
        def update(run):
            progress = run["progress"]
            progress["completed_flows"] += 1
            progress["successful_flows"] += 1 if flow_success else 0
            progress["failed_flows"] += 0 if flow_success else 1
        with_live_update(update)

    with_live_update(initialize_live)
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
            with_live_update(lambda run: run["progress"].update(
                active_users=run["progress"]["active_users"] + 1
            ))
            user_config = TestConfig.from_dict(base_config)
            user_tests = {test.id: test for test in user_config.tests}
            try:
                for iteration_index in range(iterations):
                    if stop_event.is_set() or external_stop_flag.get("stop"):
                        break
                    flow_success = True
                    for step_index, tid in enumerate(ids):
                        if stop_event.is_set() or external_stop_flag.get("stop"):
                            flow_success = False
                            break
                        with_live_update(lambda run, index=step_index: run["scenario_steps"][index].update(state="running"))
                        test = user_tests.get(tid)
                        if not test:
                            result = {"ok": False, "error": "Endpoint not found", "attempts": 1}
                            details = {
                                "test_id": tid, "name": None, "ok": False,
                                "error": "Endpoint not found",
                                "failure": {"kind": "endpoint_missing", "message": "Endpoint not found"},
                            }
                        else:
                            result = APITester(test, user_config).send_once(
                                retries=retries, retry_delay=retry_delay
                            )
                            details = _scenario_step(test, result)
                        succeeded = _step_succeeded(result)
                        record = {
                            "user": user_index + 1,
                            "iteration": iteration_index + 1,
                            "success": succeeded,
                            **details,
                        }
                        with state_lock:
                            records_by_step[step_index].append(record)
                        record_live_step(step_index, record)
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
                    record_live_flow(flow_success)
            finally:
                with_live_update(lambda run: run["progress"].update(
                    active_users=max(0, run["progress"]["active_users"] - 1)
                ))

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
        def finalize_virtual_live(run):
            progress = run["progress"]
            progress.update({
                "active_users": 0,
                "completed_flows": completed_flows,
                "successful_flows": successful_flows,
                "failed_flows": failed_flows,
            })
            for index, summary in enumerate(summaries):
                step = run["scenario_steps"][index]
                step.update({
                    key: summary.get(key)
                    for key in ("attempts", "successful", "failed", "success_rate", "avg_ms", "p95_ms")
                })
                step["state"] = "passed" if summary.get("success") else "failed"
                step.pop("_latencies", None)
            terminal_state = "cancelled" if stopped_by_user else "skipped"
            for step in run["scenario_steps"]:
                if step["state"] == "waiting":
                    step["state"] = terminal_state
            if stopped_early:
                run["failure"] = {
                    "kind": "failure_threshold",
                    "message": f"Stopped after failed journeys exceeded {stop_failure_pct:g}%",
                }
        with_live_update(finalize_virtual_live)
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
    with_live_update(lambda run: run["progress"].update(active_users=1))
    for step_index, tid in enumerate(ids):
        if external_stop_flag.get("stop"):
            break
        with_live_update(lambda run, index=step_index: run["scenario_steps"][index].update(state="running"))
        test = by_id.get(tid)
        if not test:
            step = {
                "test_id": tid, "name": None, "ok": False, "success": False,
                "error": "Endpoint not found",
                "failure": {"kind": "endpoint_missing", "message": "Endpoint not found"},
            }
            steps.append(step)
            record_live_step(step_index, {"user": 1, "iteration": 1, **step})
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
        record_live_step(step_index, {"user": 1, "iteration": 1, **step})
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
    record_live_flow(len(steps) == len(ids) and all(step.get("success") for step in steps))
    if changed:
        store.save()  # persist tokens refreshed along the chain
    stopped_by_user = bool(external_stop_flag.get("stop"))
    passed = not stopped_by_user and len(steps) == len(ids) and all(s.get("success") for s in steps)
    def finalize_single_live(run):
        run["progress"]["active_users"] = 0
        for index, step in enumerate(run["scenario_steps"]):
            step.pop("_latencies", None)
            if index < len(steps):
                step["state"] = "passed" if steps[index].get("success") else "failed"
            elif step["state"] == "waiting":
                step["state"] = "cancelled" if stopped_by_user else "skipped"
    with_live_update(finalize_single_live)
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
        "stop_flag": stop_flag, "result": None, "lock": threading.Lock(),
        "progress": None, "scenario_steps": [], "recent_events": [], "failure": None,
    }

    def run_in_thread():
        try:
            result = run_scenario({**data, "_stop_flag": stop_flag, "_run_id": run_id})
            store.current_runs[run_id]["result"] = result
            store.current_runs[run_id]["status"] = "stopped" if stop_flag["stop"] else "finished"
        except Exception as exc:
            failure = {"kind": "unknown", "message": str(exc)}
            store.current_runs[run_id]["failure"] = failure
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
    lock = run.get("lock")
    if lock:
        with lock:
            progress = copy.deepcopy(run.get("progress"))
            scenario_steps = copy.deepcopy(run.get("scenario_steps", []))
            recent_events = copy.deepcopy(run.get("recent_events", []))
            failure = copy.deepcopy(run.get("failure"))
    else:
        progress = copy.deepcopy(run.get("progress"))
        scenario_steps = copy.deepcopy(run.get("scenario_steps", []))
        recent_events = copy.deepcopy(run.get("recent_events", []))
        failure = copy.deepcopy(run.get("failure"))
    for step in scenario_steps:
        step.pop("_latencies", None)
    return {
        "status": run["status"],
        "stats": run["stats"],
        "logs": run["logs"][-100:],
        "responses": run.get("responses", [])[-100:],
        "result": run.get("result"),
        "progress": progress,
        "scenario_steps": scenario_steps,
        "recent_events": recent_events,
        "failure": failure,
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
