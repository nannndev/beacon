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
use std::time::Duration;
use tokio::time::sleep;

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
        let total = self.max_requests;
        let mut completed = 0;

        while completed < total && !self.is_stopped() {
            let batch_size = (self.concurrency as u64).min(total - completed) as usize;
            let mut handles = Vec::with_capacity(batch_size);

            for _ in 0..batch_size {
                let this = self.clone_ref();
                handles.push(tokio::spawn(async move { this.execute_single().await }));
            }

            for handle in handles {
                if let Ok(res) = handle.await {
                    completed += 1;
                    let snap = self.metrics.snapshot();
                    match res {
                        Ok(output) => on_step(&snap, Some(&output)),
                        Err(_) => on_step(&snap, None),
                    }
                }
            }

            if self.delay_ms > 0 && !self.is_stopped() {
                sleep(Duration::from_millis(self.delay_ms)).await;
            }
        }

        self.metrics.snapshot()
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
