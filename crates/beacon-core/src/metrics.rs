//! Thread-safe run counters, latency samples, and operational snapshots.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

pub fn percentile(sorted_values: &[f64], percentage: f64) -> f64 {
    let count = sorted_values.len();
    if count == 0 {
        return 0.0;
    }
    if count == 1 {
        return sorted_values[0];
    }
    let rank = (percentage / 100.0) * (count - 1) as f64;
    let lower = rank.floor() as usize;
    let upper = (lower + 1).min(count - 1);
    let fraction = rank - lower as f64;
    sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResultsCounts {
    pub attempts: u64,
    pub success: u64,
    pub rate_limited: u64,
    pub errors: u64,
    pub ws_messages_sent: u64,
    pub ws_messages_received: u64,
    pub ws_disconnects: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LatencySummary {
    pub sum: f64,
    pub count: u64,
    pub min: f64,
    pub max: f64,
    pub last: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LatencyPercentiles {
    pub avg: i64,
    pub min: i64,
    pub max: i64,
    pub last: i64,
    pub p50: i64,
    pub p75: i64,
    pub p90: i64,
    pub p95: i64,
    pub p99: i64,
    pub p999: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSnapshot {
    pub attempts: u64,
    pub success: u64,
    pub rate_limited: u64,
    pub errors: u64,
    pub ws_messages_sent: u64,
    pub ws_messages_received: u64,
    pub ws_disconnects: u64,
    pub status_codes: HashMap<String, u64>,
    pub recent_ms: Vec<i64>,
    pub latency_ms: LatencyPercentiles,
    pub elapsed_s: f64,
    pub rps: f64,
    pub first_rate_limited_at: Option<u64>,
    pub retry_after: Option<String>,
    pub probe_threshold_rps: Option<f64>,
    pub capacity_safe_rps: Option<f64>,
    pub capacity_breaking_rps: Option<f64>,
    pub capacity_breach_reason: Option<String>,
}

pub struct RunMetricsInner {
    pub results: ResultsCounts,
    pub status_codes: HashMap<String, u64>,
    pub recent_ms: Vec<i64>,
    pub all_latencies: Vec<f64>,
    pub latency: LatencySummary,
    pub first_rate_limited_at: Option<u64>,
    pub last_retry_after: Option<String>,
    pub probe_threshold_rps: Option<f64>,
    pub capacity_safe_rps: Option<f64>,
    pub capacity_breaking_rps: Option<f64>,
    pub capacity_breach_reason: Option<String>,
    pub started_at: Instant,
}

impl Default for RunMetricsInner {
    fn default() -> Self {
        Self {
            results: ResultsCounts::default(),
            status_codes: HashMap::new(),
            recent_ms: Vec::new(),
            all_latencies: Vec::new(),
            latency: LatencySummary::default(),
            first_rate_limited_at: None,
            last_retry_after: None,
            probe_threshold_rps: None,
            capacity_safe_rps: None,
            capacity_breaking_rps: None,
            capacity_breach_reason: None,
            started_at: Instant::now(),
        }
    }
}

#[derive(Clone)]
pub struct RunMetrics {
    inner: Arc<Mutex<RunMetricsInner>>,
}

impl Default for RunMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl RunMetrics {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RunMetricsInner::default())),
        }
    }

    pub fn reset(&self) {
        let mut g = self.inner.lock();
        *g = RunMetricsInner::default();
    }

    pub fn record_latency(&self, milliseconds: f64) {
        let mut g = self.inner.lock();
        g.latency.sum += milliseconds;
        g.latency.count += 1;
        g.latency.last = milliseconds;
        if g.latency.count == 1 {
            g.latency.min = milliseconds;
        } else {
            g.latency.min = g.latency.min.min(milliseconds);
        }
        g.latency.max = g.latency.max.max(milliseconds);

        let rounded = milliseconds.round() as i64;
        g.recent_ms.push(rounded);
        if g.recent_ms.len() > 60 {
            g.recent_ms.remove(0);
        }
        g.all_latencies.push(milliseconds);
    }

    pub fn record_response(
        &self,
        status_code: u16,
        milliseconds: f64,
        rate_limited: bool,
        retry_after: Option<String>,
    ) {
        let mut g = self.inner.lock();
        g.results.attempts += 1;
        if (200..300).contains(&status_code) {
            g.results.success += 1;
        } else if rate_limited {
            g.results.rate_limited += 1;
            if g.first_rate_limited_at.is_none() {
                g.first_rate_limited_at = Some(g.results.attempts);
            }
            if retry_after.is_some() {
                g.last_retry_after = retry_after;
            }
        } else {
            g.results.errors += 1;
        }

        let key = status_code.to_string();
        *g.status_codes.entry(key).or_insert(0) += 1;

        // Inlined record_latency logic while lock is already held
        g.latency.sum += milliseconds;
        g.latency.count += 1;
        g.latency.last = milliseconds;
        if g.latency.count == 1 {
            g.latency.min = milliseconds;
        } else {
            g.latency.min = g.latency.min.min(milliseconds);
        }
        g.latency.max = g.latency.max.max(milliseconds);

        let rounded = milliseconds.round() as i64;
        g.recent_ms.push(rounded);
        if g.recent_ms.len() > 60 {
            g.recent_ms.remove(0);
        }
        g.all_latencies.push(milliseconds);
    }

    pub fn record_error(&self) {
        let mut g = self.inner.lock();
        g.results.attempts += 1;
        g.results.errors += 1;
        *g.status_codes.entry("error".to_string()).or_insert(0) += 1;
    }

    pub fn record_ws_message_sent(&self) {
        let mut g = self.inner.lock();
        g.results.ws_messages_sent += 1;
    }

    pub fn record_ws_message_received(&self) {
        let mut g = self.inner.lock();
        g.results.ws_messages_received += 1;
    }

    pub fn record_ws_disconnect(&self) {
        let mut g = self.inner.lock();
        g.results.ws_disconnects += 1;
    }

    pub fn set_probe_threshold(&self, rps: f64) {
        self.inner.lock().probe_threshold_rps = Some(rps);
    }

    pub fn set_capacity_safe(&self, rps: f64) {
        self.inner.lock().capacity_safe_rps = Some(rps);
    }

    pub fn set_capacity_breaking(&self, rps: f64, reason: String) {
        let mut g = self.inner.lock();
        g.capacity_breaking_rps = Some(rps);
        g.capacity_breach_reason = Some(reason);
    }

    /// Number of latency samples recorded so far; pass it back to `p95_since`.
    pub fn latency_count(&self) -> usize {
        self.inner.lock().all_latencies.len()
    }

    pub fn p95_since(&self, offset: usize) -> f64 {
        let g = self.inner.lock();
        let mut step: Vec<f64> = g.all_latencies.get(offset..).unwrap_or(&[]).to_vec();
        step.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        percentile(&step, 95.0)
    }

    pub fn snapshot(&self) -> MetricsSnapshot {
        let g = self.inner.lock();
        let count = g.latency.count;
        let elapsed = g.started_at.elapsed().as_secs_f64().max(0.001);

        let mut sorted = g.all_latencies.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let avg = if count > 0 {
            (g.latency.sum / count as f64).round() as i64
        } else {
            0
        };

        MetricsSnapshot {
            attempts: g.results.attempts,
            success: g.results.success,
            rate_limited: g.results.rate_limited,
            errors: g.results.errors,
            ws_messages_sent: g.results.ws_messages_sent,
            ws_messages_received: g.results.ws_messages_received,
            ws_disconnects: g.results.ws_disconnects,
            status_codes: g.status_codes.clone(),
            recent_ms: g.recent_ms.clone(),
            latency_ms: LatencyPercentiles {
                avg,
                min: g.latency.min.round() as i64,
                max: g.latency.max.round() as i64,
                last: g.latency.last.round() as i64,
                p50: percentile(&sorted, 50.0).round() as i64,
                p75: percentile(&sorted, 75.0).round() as i64,
                p90: percentile(&sorted, 90.0).round() as i64,
                p95: percentile(&sorted, 95.0).round() as i64,
                p99: percentile(&sorted, 99.0).round() as i64,
                p999: percentile(&sorted, 99.9).round() as i64,
            },
            elapsed_s: (elapsed * 100.0).round() / 100.0,
            rps: ((g.results.attempts as f64 / elapsed) * 10.0).round() / 10.0,
            first_rate_limited_at: g.first_rate_limited_at,
            retry_after: g.last_retry_after.clone(),
            probe_threshold_rps: g.probe_threshold_rps,
            capacity_safe_rps: g.capacity_safe_rps,
            capacity_breaking_rps: g.capacity_breaking_rps,
            capacity_breach_reason: g.capacity_breach_reason.clone(),
        }
    }
}

