//! High-concurrency execution engine for Beacon test runs.

use crate::assertions::{evaluate_assertions, AssertionResult, ExecutionResponseContext};
use crate::extractors::ResponseExtractor;
use crate::metrics::{MetricsSnapshot, RunMetrics};
use crate::models::{EndpointTest, TestConfig};
use crate::templating::TemplateResolver;
use crate::transport::{resolve_target, HttpTransport};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::time::sleep;

/// Fuzz value generators keyed by `fuzz_types` (string, number, email, sql, xss, empty, long).
const SQL_PAYLOADS: [&str; 4] = ["' OR 1=1--", "'; DROP TABLE users;--", "1' OR '1'='1", "admin'--"];
const XSS_PAYLOADS: [&str; 4] = [
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    "<img src=x onerror=alert(1)>",
    "'\"<svg/onload=alert(1)>",
];

pub fn fuzz_value(kind: &str, seq: usize) -> Value {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    match kind {
        "number" => Value::from(rng.gen_range(0..100000)),
        "email" => Value::from(format!("fuzz{}@fuzz.test", rng.gen_range(100000..9999999))),
        "sql" => Value::from(SQL_PAYLOADS[seq % SQL_PAYLOADS.len()]),
        "xss" => Value::from(XSS_PAYLOADS[seq % XSS_PAYLOADS.len()]),
        "empty" => Value::from(""),
        "long" => Value::from("A".repeat(10000)),
        _ => {
            const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            Value::from((0..8).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect::<String>())
        }
    }
}

fn f64_of(p: &Value, key: &str, default: f64) -> f64 {
    p.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
}
fn u64_of(p: &Value, key: &str, default: u64) -> u64 {
    p.get(key).and_then(|v| v.as_u64()).unwrap_or(default)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SingleExecutionOutput {
    pub endpoint_id: String,
    pub endpoint_name: String,
    pub status: u16,
    pub time_ms: f64,
    pub target_url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub json: Option<Value>,
    pub assertions: Vec<AssertionResult>,
    pub extracted: Vec<String>,
    pub rate_limited: bool,
    pub error: Option<String>,
}

pub struct APITester {
    pub test: EndpointTest,
    pub config: TestConfig,
    pub concurrency: usize,
    pub delay_ms: u64,
    pub max_requests: u64,
    pub stop_flag: Arc<AtomicBool>,
    pub metrics: RunMetrics,
    pub transport: HttpTransport,
    pub templates: TemplateResolver,
}

impl APITester {
    pub fn new(
        test: EndpointTest,
        config: TestConfig,
        concurrency: usize,
        delay_ms: u64,
        max_requests: u64,
        stop_flag: Option<Arc<AtomicBool>>,
    ) -> Self {
        let templates = TemplateResolver::new(Arc::clone(&config.variables));
        Self {
            test,
            config,
            concurrency: concurrency.max(1),
            delay_ms,
            max_requests,
            stop_flag: stop_flag.unwrap_or_else(|| Arc::new(AtomicBool::new(false))),
            metrics: RunMetrics::new(),
            transport: HttpTransport::new(),
            templates,
        }
    }

    pub fn is_stopped(&self) -> bool {
        self.stop_flag.load(Ordering::Relaxed)
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }

    pub async fn execute_single(&self) -> Result<SingleExecutionOutput, String> {
        let raw_url = self.templates.resolve_str(&self.test.url, None);
        let target_url = resolve_target(&self.config.base_url, &raw_url);

        let mut resolved_headers = HashMap::new();
        for (k, v) in &self.test.headers {
            let val_str = match v {
                Value::String(s) => self.templates.resolve_str(s, None),
                other => other.to_string(),
            };
            resolved_headers.insert(k.clone(), val_str);
        }

        let resolved_payload = self.templates.resolve(&self.test.payload, None);

        let res = self
            .transport
            .execute(&self.test, &target_url, &resolved_headers, &resolved_payload)
            .await;

        match res {
            Ok(http_res) => {
                let is_rate_limited = http_res.status == 429
                    || http_res.body.to_lowercase().contains("rate limit")
                    || http_res.body.to_lowercase().contains("too many requests");

                let retry_after = http_res
                    .headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("retry-after"))
                    .map(|(_, v)| v.clone());

                self.metrics.record_response(
                    http_res.status,
                    http_res.time_ms,
                    is_rate_limited,
                    retry_after,
                );

                let eval_ctx = ExecutionResponseContext {
                    status: http_res.status,
                    time_ms: http_res.time_ms,
                    body: &http_res.body,
                    json: http_res.json.as_ref(),
                    headers: &http_res.headers,
                };
                let assertions = evaluate_assertions(&self.test.assertions, &eval_ctx);

                let mut extracted = Vec::new();
                if (200..300).contains(&http_res.status) && !self.test.extractors.is_empty() {
                    let mut lock = self.config.variables.write();
                    extracted = ResponseExtractor::apply(
                        &self.test,
                        http_res.json.as_ref(),
                        &http_res.headers,
                        &mut lock,
                    );
                }

                Ok(SingleExecutionOutput {
                    endpoint_id: self.test.id.clone(),
                    endpoint_name: self.test.name.clone(),
                    status: http_res.status,
                    time_ms: http_res.time_ms,
                    target_url,
                    method: self.test.method.clone(),
                    headers: http_res.headers,
                    body: http_res.body,
                    json: http_res.json,
                    assertions,
                    extracted,
                    rate_limited: is_rate_limited,
                    error: None,
                })
            }
            Err(err) => {
                self.metrics.record_error();
                Err(err.to_string())
            }
        }
    }

    pub async fn run_load<F>(&self, mut on_step: F) -> MetricsSnapshot
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
    {
        self.run_mode("load", &serde_json::json!({}), &mut on_step, &mut |_| {}).await
    }

    /// Dispatch one of the traffic modes. `params` is the raw `/run` body; unknown
    /// modes fall back to a plain load run. `on_log` receives phase messages.
    pub async fn run_mode<F, L>(&self, mode: &str, params: &Value, on_step: &mut F, on_log: &mut L) -> MetricsSnapshot
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
        L: FnMut(String),
    {
        self.metrics.reset();
        match mode.trim().to_lowercase().as_str() {
            "ramp" => self.run_ramp(params, on_step, on_log).await,
            "spike" => self.run_spike(params, on_step, on_log).await,
            "soak" => self.run_soak(params, on_step, on_log).await,
            "rate_probe" => self.run_rate_probe(params, on_step, on_log).await,
            "capacity" => self.run_capacity(params, on_step, on_log).await,
            "fuzz" => self.run_fuzz(params, on_step, on_log).await,
            "benchmark" => self.run_benchmark(params, on_step, on_log).await,
            other => {
                if other != "load" {
                    on_log(format!("[run_mode] Unknown mode '{}', falling back to 'load'", other));
                }
                self.run_batches(self.concurrency, self.max_requests, self.delay_ms, None, on_step).await
            }
        }
        self.metrics.snapshot()
    }

    /// Fire `total` requests in batches of `workers`, pausing `delay_ms` between batches.
    async fn run_batches<F>(&self, workers: usize, total: u64, delay_ms: u64, payload: Option<&Value>, on_step: &mut F)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
    {
        let mut completed = 0u64;
        while completed < total && !self.is_stopped() {
            let batch_size = (workers.max(1) as u64).min(total - completed) as usize;
            let mut handles = Vec::with_capacity(batch_size);
            for _ in 0..batch_size {
                let mut this = self.clone_ref();
                if let Some(p) = payload {
                    this.test.payload = p.clone();
                }
                handles.push(tokio::spawn(async move { this.execute_single().await }));
            }
            for handle in handles {
                if let Ok(res) = handle.await {
                    completed += 1;
                    let snap = self.metrics.snapshot();
                    on_step(&snap, res.as_ref().ok());
                }
            }
            if delay_ms > 0 && !self.is_stopped() {
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    }

    /// Submit requests on a fixed schedule (one every `interval`) until `count` is
    /// reached or `deadline` passes, with at most `concurrency` in flight.
    async fn run_paced<F>(&self, interval: Duration, count: Option<u64>, deadline: Option<Instant>, concurrency: usize, on_step: &mut F)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
    {
        let (tx, mut rx) = mpsc::unbounded_channel::<Result<SingleExecutionOutput, String>>();
        let sem = Arc::new(tokio::sync::Semaphore::new(concurrency.max(1)));
        let mut sent = 0u64;
        let mut next_send = Instant::now();
        loop {
            if self.is_stopped() || count.map_or(false, |c| sent >= c) || deadline.map_or(false, |d| Instant::now() >= d) {
                break;
            }
            // Anchor to the schedule, not to "now", so request latency does not drag the rate down.
            let now = Instant::now();
            if next_send > now {
                sleep(next_send - now).await;
            }
            next_send += interval;
            let permit = Arc::clone(&sem).acquire_owned().await.expect("semaphore closed");
            let this = self.clone_ref();
            let tx = tx.clone();
            tokio::spawn(async move {
                let res = this.execute_single().await;
                drop(permit);
                let _ = tx.send(res);
            });
            sent += 1;
            while let Ok(res) = rx.try_recv() {
                on_step(&self.metrics.snapshot(), res.as_ref().ok());
            }
        }
        drop(tx);
        while let Some(res) = rx.recv().await {
            on_step(&self.metrics.snapshot(), res.as_ref().ok());
        }
    }

    async fn run_ramp<F, L>(&self, p: &Value, on_step: &mut F, on_log: &mut L)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
        L: FnMut(String),
    {
        let start = u64_of(p, "ramp_start", 1).max(1) as usize;
        let end = u64_of(p, "ramp_end", 16).max(1) as usize;
        let step = Duration::from_secs_f64(f64_of(p, "ramp_step_duration", 10.0).max(0.1));
        let max_requests = u64_of(p, "max_requests", 500);
        let delay_ms = (f64_of(p, "delay", 0.05) * 1000.0) as u64;
        let mut workers = start;
        on_log(format!("[ramp] Starting ramp: {} -> {} workers, step={:?}, max_requests={}", workers, end, step, max_requests));
        let mut step_deadline = Instant::now() + step;
        let mut completed = 0u64;
        while completed < max_requests && !self.is_stopped() {
            if Instant::now() >= step_deadline && workers < end {
                workers = (workers * 2).min(end);
                on_log(format!("[ramp] Workers increased to {}", workers));
                step_deadline = Instant::now() + step;
            }
            let batch = (workers as u64).min(max_requests - completed);
            self.run_batches(workers, batch, delay_ms, None, on_step).await;
            completed += batch;
        }
        on_log(format!("[ramp] Finished. workers reached={}", workers));
    }

    async fn run_spike<F, L>(&self, p: &Value, on_step: &mut F, on_log: &mut L)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
        L: FnMut(String),
    {
        let baseline = u64_of(p, "baseline_workers", 2).max(1) as usize;
        let peak = u64_of(p, "peak_workers", 20).max(1) as usize;
        let delay_ms = (f64_of(p, "delay", 0.05) * 1000.0) as u64;
        let phases = [
            ("baseline", baseline, u64_of(p, "baseline_requests", 50)),
            ("peak", peak, u64_of(p, "peak_requests", 200)),
            ("recovery", baseline, u64_of(p, "recovery_requests", 50)),
        ];
        for (name, workers, n) in phases {
            if self.is_stopped() {
                break;
            }
            on_log(format!("[spike] === Phase: {} | workers={} | requests={} ===", name, workers, n));
            self.run_batches(workers, n, delay_ms, None, on_step).await;
            on_log(format!("[spike] Phase {} complete.", name));
        }
    }

    async fn run_soak<F, L>(&self, p: &Value, on_step: &mut F, on_log: &mut L)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
        L: FnMut(String),
    {
        let duration = f64_of(p, "duration_s", 300.0).max(1.0);
        let rps = f64_of(p, "rps", 5.0).max(0.001);
        let concurrency = u64_of(p, "concurrency", 1).max(1) as usize;
        on_log(format!("[soak] Starting: duration={}s rps={} concurrency={}", duration, rps, concurrency));
        let deadline = Instant::now() + Duration::from_secs_f64(duration);
        self.run_paced(Duration::from_secs_f64(1.0 / rps), None, Some(deadline), concurrency, on_step).await;
        let snap = self.metrics.snapshot();
        on_log(format!("[soak] Finished. duration={}s attempts={} avg_rps={}", snap.elapsed_s.round(), snap.attempts, snap.rps));
    }

    async fn run_rate_probe<F, L>(&self, p: &Value, on_step: &mut F, on_log: &mut L)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
        L: FnMut(String),
    {
        let mut rps = f64_of(p, "start_rps", 1.0).max(0.001);
        let step_rps = f64_of(p, "step_rps", 1.0).max(0.001);
        let step_requests = u64_of(p, "step_requests", 20).max(1);
        let max_rps = f64_of(p, "max_rps", 100.0);
        on_log(format!("[probe] Starting rate probe: {} -> {} rps, step={}, step_requests={}", rps, max_rps, step_rps, step_requests));
        let mut found = None;
        while rps <= max_rps && !self.is_stopped() {
            let before = self.metrics.snapshot().rate_limited;
            on_log(format!("[probe] Testing at {:.1} rps ...", rps));
            self.run_paced(Duration::from_secs_f64(1.0 / rps), Some(step_requests), None, step_requests as usize, on_step).await;
            if self.metrics.snapshot().rate_limited > before {
                self.metrics.set_probe_threshold(rps);
                on_log(format!("[probe] Rate limit threshold found at {:.1} rps", rps));
                found = Some(rps);
                break;
            }
            on_log(format!("[probe] No rate limit at {:.1} rps. Stepping up.", rps));
            rps = ((rps + step_rps) * 1000.0).round() / 1000.0;
        }
        if found.is_none() && !self.is_stopped() {
            on_log(format!("[probe] No rate limit detected up to {:.1} rps", max_rps));
        }
        on_step(&self.metrics.snapshot(), None);
    }

    async fn run_capacity<F, L>(&self, p: &Value, on_step: &mut F, on_log: &mut L)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
        L: FnMut(String),
    {
        let mut rps = f64_of(p, "start_rps", 5.0).max(0.1);
        let step_rps = f64_of(p, "step_rps", 5.0).max(0.1);
        let step_requests = u64_of(p, "step_requests", 30).max(1);
        let max_rps = f64_of(p, "max_rps", 200.0);
        let p95_limit = f64_of(p, "p95_limit_ms", 500.0);
        let error_limit = f64_of(p, "error_limit_pct", 1.0);
        let success_min = f64_of(p, "success_min_pct", 99.0);
        let workers = ((max_rps as usize) + 1).clamp(2, 256);
        on_log(format!("[capacity] Starting {:.1} -> {:.1} rps; SLO p95<={:.0}ms errors<={:.1}% success>={:.1}%", rps, max_rps, p95_limit, error_limit, success_min));
        let mut broke = false;
        while rps <= max_rps && !self.is_stopped() {
            let before = self.metrics.snapshot();
            let offset = self.metrics.latency_count();
            on_log(format!("[capacity] Testing {:.1} rps ({} requests) ...", rps, step_requests));
            self.run_paced(Duration::from_secs_f64(1.0 / rps), Some(step_requests), None, workers, on_step).await;
            let after = self.metrics.snapshot();
            let attempts = after.attempts - before.attempts;
            let successes = after.success - before.success;
            let failures = (after.errors - before.errors) + (after.rate_limited - before.rate_limited);
            let p95 = self.metrics.p95_since(offset);
            let error_pct = if attempts > 0 { failures as f64 / attempts as f64 * 100.0 } else { 100.0 };
            let success_pct = if attempts > 0 { successes as f64 / attempts as f64 * 100.0 } else { 0.0 };
            let mut reasons = Vec::new();
            if p95 > p95_limit {
                reasons.push(format!("p95 {:.0}ms > {:.0}ms", p95, p95_limit));
            }
            if error_pct > error_limit {
                reasons.push(format!("errors {:.1}% > {:.1}%", error_pct, error_limit));
            }
            if success_pct < success_min {
                reasons.push(format!("success {:.1}% < {:.1}%", success_pct, success_min));
            }
            on_log(format!("[capacity] {:.1} rps result: p95={:.0}ms errors={:.1}% success={:.1}%", rps, p95, error_pct, success_pct));
            if !reasons.is_empty() {
                let reason = reasons.join("; ");
                self.metrics.set_capacity_breaking(rps, reason.clone());
                on_log(format!("[capacity] Breaking point: {:.1} rps - {}", rps, reason));
                broke = true;
                break;
            }
            self.metrics.set_capacity_safe(rps);
            on_step(&self.metrics.snapshot(), None);
            rps = ((rps + step_rps) * 1000.0).round() / 1000.0;
        }
        let snap = self.metrics.snapshot();
        if !broke && !self.is_stopped() {
            on_log(format!("[capacity] SLO remained healthy through {:.1} rps", snap.capacity_safe_rps.unwrap_or(0.0)));
        }
        on_step(&snap, None);
    }

    async fn run_fuzz<F, L>(&self, p: &Value, on_step: &mut F, on_log: &mut L)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
        L: FnMut(String),
    {
        let fuzz_types: HashMap<String, String> = p
            .get("fuzz_types")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let max_requests = u64_of(p, "max_requests", 100);
        let concurrency = u64_of(p, "concurrency", 1).max(1) as usize;
        let delay_ms = (f64_of(p, "delay", 0.05) * 1000.0) as u64;
        let fields: Vec<&String> = fuzz_types.keys().collect();
        on_log(format!("[fuzz] Starting: fields={:?} max_requests={} concurrency={}", fields, max_requests, concurrency));
        let mut i = 0usize;
        while (i as u64) < max_requests && !self.is_stopped() {
            let mut payload = self.test.payload.clone();
            if !payload.is_object() {
                payload = Value::Object(Default::default());
            }
            let obj = payload.as_object_mut().unwrap();
            for (field, kind) in &fuzz_types {
                obj.insert(field.clone(), fuzz_value(&kind.to_lowercase(), i));
            }
            let batch = (concurrency as u64).min(max_requests - i as u64);
            self.run_batches(concurrency, batch, delay_ms, Some(&payload), on_step).await;
            i += batch as usize;
        }
        on_log("[fuzz] Finished.".to_string());
    }

    async fn run_benchmark<F, L>(&self, p: &Value, on_step: &mut F, on_log: &mut L)
    where
        F: FnMut(&MetricsSnapshot, Option<&SingleExecutionOutput>),
        L: FnMut(String),
    {
        let samples = u64_of(p, "n_samples", 100);
        let warmup = u64_of(p, "warmup", 10);
        on_log(format!("[benchmark] Warming up ({} requests, stats discarded) ...", warmup));
        self.run_batches(1, warmup, 0, None, &mut |_, _| {}).await;
        self.metrics.reset();
        on_log(format!("[benchmark] Warmup done. Running {} samples ...", samples));
        self.run_batches(1, samples, 0, None, on_step).await;
        let l = self.metrics.snapshot().latency_ms;
        on_log(format!(
            "[benchmark] Results: p50={}ms p75={}ms p90={}ms p95={}ms p99={}ms p999={}ms",
            l.p50, l.p75, l.p90, l.p95, l.p99, l.p999
        ));
    }

    fn clone_ref(&self) -> Self {
        Self {
            test: self.test.clone(),
            config: self.config.clone(),
            concurrency: self.concurrency,
            delay_ms: self.delay_ms,
            max_requests: self.max_requests,
            stop_flag: Arc::clone(&self.stop_flag),
            metrics: self.metrics.clone(),
            transport: HttpTransport::new(),
            templates: TemplateResolver::new(Arc::clone(&self.config.variables)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuzz_values_follow_type() {
        assert_eq!(fuzz_value("sql", 1), Value::from(SQL_PAYLOADS[1]));
        assert_eq!(fuzz_value("sql", 5), Value::from(SQL_PAYLOADS[1]));
        assert_eq!(fuzz_value("empty", 0), Value::from(""));
        assert_eq!(fuzz_value("long", 0).as_str().unwrap().len(), 10000);
        assert!(fuzz_value("number", 0).is_number());
        assert!(fuzz_value("email", 0).as_str().unwrap().ends_with("@fuzz.test"));
        assert_eq!(fuzz_value("string", 0).as_str().unwrap().len(), 8);
    }

    #[tokio::test]
    async fn benchmark_mode_discards_warmup_and_reports_samples() {
        // Unresolvable host: every request errors fast, which is enough to count attempts.
        let test = EndpointTest::new(None, "t".into(), "http://127.0.0.1:1/x".into(), Some("GET".into()));
        let tester = APITester::new(test, TestConfig::default(), 1, 0, 1, None);
        let mut logs = Vec::new();
        let snap = tester
            .run_mode("benchmark", &serde_json::json!({ "n_samples": 3, "warmup": 2 }), &mut |_, _| {}, &mut |l| logs.push(l))
            .await;
        assert_eq!(snap.attempts, 3);
        assert!(logs.iter().any(|l| l.starts_with("[benchmark] Results")));
    }
}
