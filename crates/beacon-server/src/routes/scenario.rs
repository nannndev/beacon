//! `POST /scenario` (synchronous) and `POST /scenario/start` (cancellable,
//! polled through `/status/:run_id`). Port of the Python scenario runner.

use crate::history::{RunStart, StepStart};
use crate::routes::history::active_project;
use crate::state::{ActiveRun, AppState};
use axum::{extract::State, http::StatusCode, response::Json};
use beacon_core::{APITester, EndpointTest, TestConfig};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

type ApiError = (StatusCode, Json<Value>);

fn bad(detail: &str) -> ApiError {
    (StatusCode::BAD_REQUEST, Json(json!({ "detail": detail })))
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

fn p95(sorted: &[f64]) -> f64 {
    sorted[((sorted.len() - 1) as f64 * 0.95) as usize]
}

struct Settings {
    ids: Vec<String>,
    cont: bool,
    retries: u32,
    retry_delay: f64,
    virtual_users: usize,
    iterations: usize,
    ramp_up_s: f64,
    think_time_s: f64,
    stop_failure_pct: f64,
}

fn parse(data: &Value) -> Result<Settings, ApiError> {
    let ids: Vec<String> = match data["test_ids"].as_array() {
        Some(a) if !a.is_empty() => a.iter().map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string)).collect(),
        _ => return Err(bad("test_ids must be a non-empty list")),
    };
    let num = |key: &str, default: f64| -> Result<f64, ApiError> {
        match &data[key] {
            Value::Null => Ok(default),
            Value::Number(n) => n.as_f64().ok_or(()),
            Value::String(s) => s.trim().parse().map_err(|_| ()),
            _ => Err(()),
        }
        .map_err(|_| bad("scenario settings must be numbers"))
    };
    Ok(Settings {
        cont: data["continue_on_error"].as_bool().unwrap_or(false),
        retries: num("retries", 0.0)?.max(0.0) as u32,
        retry_delay: num("retry_delay", 0.0)?.max(0.0),
        virtual_users: num("virtual_users", 1.0)?.max(1.0) as usize,
        iterations: num("iterations", 1.0)?.max(1.0) as usize,
        ramp_up_s: num("ramp_up_s", 0.0)?.max(0.0),
        think_time_s: num("think_time_ms", 0.0)?.max(0.0) / 1000.0,
        stop_failure_pct: num("stop_failure_pct", 100.0)?.clamp(0.0, 100.0),
        ids,
    })
}

/// One executed step: the UI-facing record plus the fields history needs.
struct StepOutcome {
    record: Value,
    success: bool,
    status: Option<u16>,
    time_ms: Option<f64>,
    attempts: i64,
    extracted: bool,
    error: Option<String>,
}

fn failure_of(ok: bool, error: Option<&str>, status: Option<u16>, assertions: &[beacon_core::AssertionResult]) -> Value {
    if !ok {
        let message = error.unwrap_or("Request failed").to_string();
        let lower = message.to_lowercase();
        let kind = if lower.contains("timeout") || lower.contains("timed out") { "timeout" } else { "transport_error" };
        return json!({ "kind": kind, "message": message });
    }
    let failed: Vec<Value> = assertions
        .iter()
        .filter(|a| !a.ok)
        .map(|a| json!({ "message": a.message, "expected": a.expected, "actual": a.actual }))
        .collect();
    if let Some(first) = failed.first() {
        let message = first["message"].as_str().filter(|m| !m.is_empty()).unwrap_or("Response assertion failed").to_string();
        return json!({ "kind": "assertion_failed", "message": message, "status": status, "assertion_failures": failed });
    }
    match status {
        Some(s) if s >= 400 => json!({ "kind": "http_error", "message": format!("HTTP {s} returned by the endpoint"), "status": s }),
        _ => Value::Null,
    }
}

/// Send once, retrying while the request errors or returns non-2xx.
async fn send_step(test: Option<&EndpointTest>, tid: &str, config: &TestConfig, s: &Settings) -> StepOutcome {
    let Some(test) = test else {
        return StepOutcome {
            record: json!({
                "test_id": tid, "name": null, "ok": false, "error": "Endpoint not found",
                "failure": { "kind": "endpoint_missing", "message": "Endpoint not found" },
            }),
            success: false,
            status: None,
            time_ms: None,
            attempts: 1,
            extracted: false,
            error: Some("Endpoint not found".into()),
        };
    };
    let total = s.retries + 1;
    let mut attempt = 1;
    let (result, elapsed) = loop {
        let started = Instant::now();
        let res = APITester::new(test.clone(), config.clone(), 1, 0, 1, None).execute_single().await;
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let retry = match &res {
            Ok(out) => !(200..300).contains(&out.status),
            Err(_) => true,
        };
        if !retry || attempt == total {
            break (res, elapsed);
        }
        attempt += 1;
        if s.retry_delay > 0.0 {
            tokio::time::sleep(Duration::from_secs_f64(s.retry_delay)).await;
        }
    };
    let (ok, status, time_ms, passed, extracted, error, failure) = match &result {
        Ok(out) => {
            let passed = (!out.assertions.is_empty()).then(|| out.assertions.iter().all(|a| a.ok));
            (true, Some(out.status), out.time_ms.round(), passed, out.extracted.clone(), None, failure_of(true, None, Some(out.status), &out.assertions))
        }
        Err(e) => (false, None, elapsed.round(), None, Vec::new(), Some(e.clone()), failure_of(false, Some(e), None, &[])),
    };
    let success = ok && passed != Some(false) && status.map_or(true, |s| s < 400);
    let mut record = json!({
        "test_id": test.id, "name": test.name, "ok": ok, "status": status, "time_ms": time_ms,
        "passed": passed, "extracted": extracted, "attempts": attempt,
    });
    if !ok {
        record["error"] = json!(error);
    }
    if !failure.is_null() {
        record["failure"] = failure;
    }
    StepOutcome { record, success, status, time_ms: Some(time_ms), attempts: attempt as i64, extracted: !extracted.is_empty(), error }
}

/// Live progress written into the polled `ActiveRun`.
struct Live {
    run: Option<Arc<ActiveRun>>,
    latencies: Mutex<Vec<Vec<f64>>>,
    methods: HashMap<String, String>,
}

impl Live {
    fn init(&self, ids: &[String], by_id: &HashMap<String, EndpointTest>, total_flows: usize) {
        let Some(run) = &self.run else { return };
        *run.progress.write() = json!({
            "scope": if ids.len() == 1 { "endpoint" } else { "journey" },
            "total_flows": total_flows, "completed_flows": 0, "successful_flows": 0, "failed_flows": 0,
            "active_users": 0, "requests_completed": 0, "successful_requests": 0, "failed_requests": 0, "rate_limited": 0,
        });
        *run.scenario_steps.write() = ids
            .iter()
            .map(|tid| {
                let t = by_id.get(tid);
                json!({
                    "test_id": tid, "name": t.map(|t| &t.name), "method": t.map(|t| &t.method), "state": "waiting",
                    "attempts": 0, "successful": 0, "failed": 0, "success_rate": 0.0, "avg_ms": null, "p95_ms": null,
                    "last_status": null, "failure": null,
                })
            })
            .collect();
        run.recent_events.write().clear();
    }

    fn progress(&self, f: impl FnOnce(&mut Value)) {
        if let Some(run) = &self.run {
            f(&mut run.progress.write());
        }
    }

    fn set_state(&self, index: usize, state: &str) {
        if let Some(run) = &self.run {
            run.scenario_steps.write()[index]["state"] = json!(state);
        }
    }

    fn step(&self, index: usize, out: &StepOutcome, user: usize, iteration: usize) {
        let Some(run) = &self.run else { return };
        let ok = out.success;
        {
            let mut steps = run.scenario_steps.write();
            let step = &mut steps[index];
            let attempts = step["attempts"].as_i64().unwrap_or(0) + 1;
            let successful = step["successful"].as_i64().unwrap_or(0) + ok as i64;
            let failed = step["failed"].as_i64().unwrap_or(0) + !ok as i64;
            step["attempts"] = json!(attempts);
            step["successful"] = json!(successful);
            step["failed"] = json!(failed);
            step["success_rate"] = json!(round1(successful as f64 / attempts as f64 * 100.0));
            step["last_status"] = json!(out.status);
            if let Some(t) = out.time_ms {
                let mut lat = self.latencies.lock();
                lat[index].push(t);
                let mut v = lat[index].clone();
                v.sort_by(|a, b| a.partial_cmp(b).unwrap());
                step["avg_ms"] = json!(round1(v.iter().sum::<f64>() / v.len() as f64));
                step["p95_ms"] = json!(round1(p95(&v)));
            }
            if !out.record["failure"].is_null() {
                step["failure"] = out.record["failure"].clone();
            }
            step["state"] = json!(if failed > 0 { "failed" } else { "running" });
        }
        self.progress(|p| {
            let inc = |p: &mut Value, k: &str, n: bool| p[k] = json!(p[k].as_i64().unwrap_or(0) + n as i64);
            inc(p, "requests_completed", true);
            inc(p, "successful_requests", ok);
            inc(p, "failed_requests", !ok);
            inc(p, "rate_limited", out.status == Some(429));
        });
        let tid = out.record["test_id"].as_str().unwrap_or("");
        let event = json!({
            "at_ms": chrono::Utc::now().timestamp_millis(), "step_index": index, "test_id": tid,
            "name": out.record["name"], "method": self.methods.get(tid), "user": user, "iteration": iteration,
            "state": if ok { "passed" } else { "failed" }, "status": out.status, "time_ms": out.time_ms,
            "attempts": out.attempts, "extracted": out.record.get("extracted").cloned().unwrap_or(json!([])),
            "failure": out.record["failure"],
        });
        let mut events = run.recent_events.write();
        events.push(event);
        if events.len() > 100 {
            events.remove(0);
        }
    }

    fn flow(&self, success: bool) {
        self.progress(|p| {
            for (k, n) in [("completed_flows", true), ("successful_flows", success), ("failed_flows", !success)] {
                p[k] = json!(p[k].as_i64().unwrap_or(0) + n as i64);
            }
        });
    }

    fn active_users(&self, delta: i64) {
        self.progress(|p| p["active_users"] = json!((p["active_users"].as_i64().unwrap_or(0) + delta).max(0)));
    }

    /// Final step states; steps that never ran become skipped / cancelled.
    fn finalize(&self, states: &[Option<bool>], stopped: bool, summaries: Option<&[Value]>) {
        let Some(run) = &self.run else { return };
        let mut steps = run.scenario_steps.write();
        for (i, step) in steps.iter_mut().enumerate() {
            if let Some(s) = summaries.and_then(|s| s.get(i)) {
                for k in ["attempts", "successful", "failed", "success_rate", "avg_ms", "p95_ms"] {
                    step[k] = s[k].clone();
                }
            }
            match states.get(i).copied().flatten() {
                Some(ok) => step["state"] = json!(if ok { "passed" } else { "failed" }),
                None if step["state"] == "waiting" => step["state"] = json!(if stopped { "cancelled" } else { "skipped" }),
                None => {}
            }
        }
        drop(steps);
        self.progress(|p| p["active_users"] = json!(0));
    }
}

fn record_history(state: &AppState, history_id: &str, index: usize, out: &StepOutcome, success_flag: bool) {
    state.history.record_response(
        history_id,
        index as i64,
        out.status,
        out.time_ms,
        out.status == Some(429),
        success_flag,
        out.error.as_deref(),
    );
}

/// Sleep in short slices so Stop stays responsive.
async fn wait(dur: f64, stop: &(dyn Fn() -> bool + Sync)) {
    let deadline = Instant::now() + Duration::from_secs_f64(dur);
    while !stop() && Instant::now() < deadline {
        tokio::time::sleep((deadline - Instant::now()).min(Duration::from_millis(100))).await;
    }
}

pub async fn execute(state: AppState, data: Value, stop: Arc<AtomicBool>, live_run: Option<Arc<ActiveRun>>) -> Result<Value, ApiError> {
    let s = Arc::new(parse(&data)?);
    let (base_config, by_id) = {
        let store = state.store.read();
        let cfg = store.current_config.clone();
        let by_id: HashMap<String, EndpointTest> = cfg.tests.iter().map(|t| (t.id.clone(), t.clone())).collect();
        (cfg, by_id)
    };
    let ids = &s.ids;
    let total_flows = s.virtual_users * s.iterations;
    let live = Arc::new(Live {
        run: live_run,
        latencies: Mutex::new(vec![Vec::new(); ids.len()]),
        methods: by_id.iter().map(|(k, t)| (k.clone(), t.method.clone())).collect(),
    });
    live.init(ids, &by_id, total_flows);

    let history_id = uuid::Uuid::new_v4().simple().to_string()[..16].to_string();
    let (project_id, project_name) = active_project(&state);
    state.history.start(
        RunStart {
            id: history_id.clone(),
            project_id,
            project_name,
            source_type: "scenario".into(),
            target_id: None,
            target_name: format!("Scenario · {} steps", ids.len()),
            mode: "scenario".into(),
            config_snapshot: json!({
                "mode": "scenario", "virtual_users": s.virtual_users, "iterations": s.iterations,
                "ramp_up_s": s.ramp_up_s, "think_time_ms": (s.think_time_s * 1000.0).round() as i64,
                "stop_failure_pct": s.stop_failure_pct,
            }),
        },
        ids.iter()
            .enumerate()
            .filter_map(|(i, tid)| by_id.get(tid).map(|t| StepStart { sequence: i as i64, endpoint_id: t.id.clone(), endpoint_name: t.name.clone(), method: t.method.clone(), url_template: t.url.clone() }))
            .collect(),
    );
    let finish_status = |stopped: bool, passed: bool| if stopped { "stopped" } else if passed { "completed" } else { "failed" };

    if s.virtual_users == 1 && s.iterations == 1 {
        // Single journey on the live config so extracted tokens persist.
        let mut steps = Vec::new();
        let mut states = Vec::new();
        let mut changed = false;
        live.active_users(1);
        for (i, tid) in ids.iter().enumerate() {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            live.set_state(i, "running");
            let out = send_step(by_id.get(tid), tid, &base_config, &s).await;
            changed |= out.extracted;
            let mut record = out.record.clone();
            if by_id.contains_key(tid) {
                record["success"] = json!(out.success);
                record_history(&state, &history_id, i, &out, false);
                let a = out.attempts;
                state.history.record_stats(&history_id, i as i64, [a, if out.success { a } else { 0 }, if out.status == Some(429) { a } else { 0 }, if out.success { 0 } else { a }]);
                state.history.finish_step(&history_id, i as i64, if out.success { "completed" } else { "failed" });
            }
            live.step(i, &out, 1, 1);
            states.push(Some(out.success));
            steps.push(record);
            if !out.success && !s.cont {
                break;
            }
        }
        let all_ok = steps.len() == ids.len() && steps.iter().all(|st| st["success"] == true);
        live.flow(all_ok);
        if changed {
            let _ = state.store.write().save();
        }
        let stopped = stop.load(Ordering::Relaxed);
        let passed = !stopped && all_ok;
        live.finalize(&states, stopped, None);
        state.history.finish_run(&history_id, finish_status(stopped, passed));
        return Ok(json!({
            "steps": steps, "passed": passed, "completed": steps.len(), "total": ids.len(),
            "history_id": history_id, "stopped": stopped,
        }));
    }

    // Virtual users: each user runs on an isolated copy of the config.
    let started = Instant::now();
    let records: Arc<Mutex<Vec<Vec<(Value, StepOutcome)>>>> = Arc::new(Mutex::new((0..ids.len()).map(|_| Vec::new()).collect()));
    let flows = Arc::new(Mutex::new((0usize, 0usize)));
    let internal_stop = Arc::new(AtomicBool::new(false));
    let stopped_early = Arc::new(AtomicBool::new(false));
    let by_id = Arc::new(by_id);
    let snapshot = (base_config.base_url.clone(), base_config.snapshot_variables(), base_config.tests.clone());
    let pool = Arc::new(tokio::sync::Semaphore::new(s.virtual_users.min(64)));
    let mut handles = Vec::new();
    for user in 0..s.virtual_users {
        let (s, live, records, flows, by_id, pool) = (s.clone(), live.clone(), records.clone(), flows.clone(), by_id.clone(), pool.clone());
        let (stop, internal_stop, stopped_early, snapshot) = (stop.clone(), internal_stop.clone(), stopped_early.clone(), snapshot.clone());
        handles.push(tokio::spawn(async move {
            let halted = || stop.load(Ordering::Relaxed) || internal_stop.load(Ordering::Relaxed);
            if s.ramp_up_s > 0.0 && s.virtual_users > 1 {
                let at = s.ramp_up_s * user as f64 / (s.virtual_users - 1) as f64;
                wait((at - started.elapsed().as_secs_f64()).max(0.0), &halted).await;
            }
            let _permit = pool.acquire().await;
            live.active_users(1);
            let config = TestConfig::new(snapshot.0, snapshot.1, snapshot.2);
            for iteration in 0..s.iterations {
                if halted() {
                    break;
                }
                let mut flow_ok = true;
                for (i, tid) in s.ids.iter().enumerate() {
                    if halted() {
                        flow_ok = false;
                        break;
                    }
                    live.set_state(i, "running");
                    let out = send_step(by_id.get(tid), tid, &config, &s).await;
                    let mut record = json!({ "user": user + 1, "iteration": iteration + 1, "success": out.success });
                    for (k, v) in out.record.as_object().unwrap() {
                        record[k] = v.clone();
                    }
                    live.step(i, &out, user + 1, iteration + 1);
                    let ok = out.success;
                    records.lock()[i].push((record, out));
                    if !ok {
                        flow_ok = false;
                        if !s.cont {
                            break;
                        }
                    }
                    if s.think_time_s > 0.0 && i + 1 < s.ids.len() {
                        wait(s.think_time_s, &halted).await;
                    }
                }
                {
                    let mut f = flows.lock();
                    f.0 += 1;
                    f.1 += flow_ok as usize;
                    let failure_pct = (f.0 - f.1) as f64 / f.0 as f64 * 100.0;
                    if f.0 >= s.virtual_users && failure_pct > s.stop_failure_pct {
                        stopped_early.store(true, Ordering::Relaxed);
                        internal_stop.store(true, Ordering::Relaxed);
                    }
                }
                live.flow(flow_ok);
            }
            live.active_users(-1);
        }));
    }
    for h in handles {
        let _ = h.await;
    }

    let records = std::mem::take(&mut *records.lock());
    let mut summaries = Vec::new();
    for (i, tid) in ids.iter().enumerate() {
        let recs = &records[i];
        let mut lat: Vec<f64> = recs.iter().filter_map(|(_, o)| o.time_ms).collect();
        lat.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let attempts = recs.len() as i64;
        let successes = recs.iter().filter(|(_, o)| o.success).count() as i64;
        let all_ok = attempts > 0 && successes == attempts;
        summaries.push(json!({
            "test_id": tid, "name": by_id.get(tid).map(|t| &t.name), "ok": all_ok, "success": all_ok,
            "attempts": attempts, "successful": successes, "failed": attempts - successes,
            "success_rate": if attempts > 0 { round1(successes as f64 / attempts as f64 * 100.0) } else { 0.0 },
            "avg_ms": (!lat.is_empty()).then(|| round1(lat.iter().sum::<f64>() / lat.len() as f64)),
            "p95_ms": (!lat.is_empty()).then(|| round1(p95(&lat))),
            "error": recs.iter().find_map(|(r, _)| r["error"].as_str().map(str::to_string)),
        }));
        for (_, out) in recs {
            record_history(&state, &history_id, i, out, out.success);
        }
        let rl = recs.iter().filter(|(_, o)| o.status == Some(429)).count() as i64;
        state.history.record_stats(&history_id, i as i64, [attempts, successes, rl, attempts - successes]);
        state.history.finish_step(&history_id, i as i64, if all_ok { "completed" } else { "failed" });
    }
    let (completed_flows, successful_flows) = *flows.lock();
    let failed_flows = completed_flows - successful_flows;
    let stopped = stop.load(Ordering::Relaxed);
    let early = stopped_early.load(Ordering::Relaxed);
    let passed = !stopped && completed_flows == total_flows && failed_flows == 0;
    let bottleneck = summaries
        .iter()
        .filter(|s| s["p95_ms"].is_number())
        .max_by(|a, b| a["p95_ms"].as_f64().partial_cmp(&b["p95_ms"].as_f64()).unwrap())
        .map(|s| json!({ "test_id": s["test_id"], "name": s["name"], "p95_ms": s["p95_ms"] }));
    let states: Vec<Option<bool>> = summaries.iter().map(|s| Some(s["success"] == true)).collect();
    live.finalize(&states, stopped, Some(&summaries));
    live.progress(|p| {
        p["completed_flows"] = json!(completed_flows);
        p["successful_flows"] = json!(successful_flows);
        p["failed_flows"] = json!(failed_flows);
    });
    if let (true, Some(run)) = (early, &live.run) {
        *run.failure.write() = Some(json!({
            "kind": "failure_threshold",
            "message": format!("Stopped after failed journeys exceeded {}%", s.stop_failure_pct),
        }));
    }
    state.history.finish_run(&history_id, finish_status(stopped, passed));
    Ok(json!({
        "steps": summaries, "passed": passed, "completed": summaries.len(), "total": ids.len(),
        "history_id": history_id, "virtual_users": s.virtual_users, "iterations": s.iterations,
        "total_flows": total_flows, "completed_flows": completed_flows,
        "successful_flows": successful_flows, "failed_flows": failed_flows,
        "success_rate": if completed_flows > 0 { round1(successful_flows as f64 / completed_flows as f64 * 100.0) } else { 0.0 },
        "duration_ms": started.elapsed().as_millis() as i64,
        "stopped_early": early, "stopped": stopped, "bottleneck": bottleneck,
    }))
}

pub async fn run_scenario(State(state): State<AppState>, Json(data): Json<Value>) -> Result<Json<Value>, ApiError> {
    execute(state, data, Arc::new(AtomicBool::new(false)), None).await.map(Json)
}

pub async fn start_scenario(State(state): State<AppState>, Json(data): Json<Value>) -> Result<Json<Value>, ApiError> {
    parse(&data)?;
    let run_id = uuid::Uuid::new_v4().simple().to_string()[..16].to_string();
    let run = Arc::new(ActiveRun::new(run_id.clone(), String::new()));
    state.runs.write().insert(run_id.clone(), run.clone());
    tokio::spawn(async move {
        let stop = run.stop_flag.clone();
        let outcome = execute(state, data, stop.clone(), Some(run.clone())).await;
        let status = match outcome {
            Ok(result) => {
                *run.result.write() = Some(result);
                if stop.load(Ordering::Relaxed) { "stopped" } else { "finished" }
            }
            Err((_, Json(body))) => {
                let message = body["detail"].as_str().unwrap_or("Scenario failed").to_string();
                *run.failure.write() = Some(json!({ "kind": "unknown", "message": message }));
                *run.result.write() = Some(json!({ "passed": false, "error": message, "steps": [] }));
                "failed"
            }
        };
        *run.status.write() = status.into();
    });
    Ok(Json(json!({ "run_id": run_id, "mode": "scenario" })))
}
