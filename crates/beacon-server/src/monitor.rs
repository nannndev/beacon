//! Scheduled monitor (port of services/monitor.py): re-runs each project's requests
//! every `notifications.monitor_minutes` and reports through the Discord/Slack notifier.
use crate::state::AppState;
use beacon_core::APITester;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

const TICK: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct Monitor {
    last_run: Mutex<HashMap<String, Instant>>,
    pub results: Mutex<HashMap<String, Value>>,
}

fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Runs every request of one project once; returns the summary the UI shows.
pub async fn check_project(state: &AppState, project_id: &str) -> Value {
    let (config, name, settings) = {
        let store = state.store.read();
        let Some(p) = store.projects.iter().find(|p| p.id == project_id) else {
            return json!({ "checked_at": now_iso(), "passed": false, "summary": null, "failures": [], "error": "Project not found" });
        };
        (store.config_for(p), p.name.clone(), p.notifications.clone())
    };
    let checked_at = now_iso();
    let (mut passed, mut failed, mut rate_limited) = (0u64, 0u64, 0u64);
    let mut failures = Vec::new();
    for test in config.tests.clone() {
        let tester = APITester::new(test.clone(), config.clone(), 1, 0, 1, None);
        let (ok, error) = match tester.execute_single().await {
            Ok(out) => {
                rate_limited += out.rate_limited as u64;
                let ok = (200..300).contains(&out.status) && out.error.is_none() && out.assertions.iter().all(|a| a.ok);
                let err = out.error.clone().or_else(|| (!(200..300).contains(&out.status)).then(|| format!("HTTP {}", out.status)))
                    .or_else(|| out.assertions.iter().find(|a| !a.ok).map(|a| a.message.clone()));
                (ok, err)
            }
            Err(e) => (false, Some(e)),
        };
        if ok { passed += 1 } else { failed += 1; failures.push(json!({ "name": test.name, "error": error })); }
    }
    let total = passed + failed;
    let stats = json!({ "attempts": total, "success": passed, "rate_limited": rate_limited, "errors": failed });
    crate::notify::maybe_notify(settings.as_ref(), &name, "monitor", &stats, "completed", &name);
    failures.truncate(20);
    json!({
        "checked_at": checked_at,
        "passed": total > 0 && failed == 0,
        "summary": { "total": total, "passed": passed, "failed": failed },
        "failures": failures,
    })
}

impl Monitor {
    /// Projects whose interval has elapsed; marks them as run so a slow check isn't started twice.
    fn due(&self, state: &AppState, now: Instant) -> Vec<String> {
        let store = state.store.read();
        let mut last = self.last_run.lock();
        store.projects.iter().filter_map(|p| {
            let minutes = p.notifications.as_ref().and_then(|n| n["monitor_minutes"].as_u64()).unwrap_or(0);
            if minutes == 0 { return None; }
            let elapsed = last.get(&p.id).map(|t| now.duration_since(*t) >= Duration::from_secs(minutes * 60)).unwrap_or(true);
            elapsed.then(|| { last.insert(p.id.clone(), now); p.id.clone() })
        }).collect()
    }

    pub fn spawn(self: &Arc<Self>, state: AppState) {
        let me = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(TICK).await;
                for pid in me.due(&state, Instant::now()) {
                    let result = check_project(&state, &pid).await;
                    me.results.lock().insert(pid, result);
                }
            }
        });
    }
}
