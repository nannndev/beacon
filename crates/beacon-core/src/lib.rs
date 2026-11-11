pub mod assertions;
pub mod extractors;
pub mod metrics;
pub mod models;
pub mod templating;
pub mod tester;
pub mod transport;

pub use assertions::{compare, dig, evaluate_assertions, AssertionResult, ExecutionResponseContext};
pub use extractors::ResponseExtractor;
pub use metrics::{percentile, LatencyPercentiles, MetricsSnapshot, RunMetrics};
pub use models::{normalize_request_options, EndpointTest, RequestOptions, TestConfig};
pub use templating::TemplateResolver;
pub use tester::{APITester, SingleExecutionOutput};
pub use transport::{resolve_target, HttpExecutionResult, HttpTransport};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn test_models_json_roundtrip() {
        let ep = EndpointTest::new(
            Some("ep-1".into()),
            "Get Users".into(),
            "/api/users".into(),
            Some("GET".into()),
        );
        let serialized = serde_json::to_string(&ep).unwrap();
        let deserialized: EndpointTest = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.id, "ep-1");
        assert_eq!(deserialized.name, "Get Users");
        assert_eq!(deserialized.method, "GET");
    }

    #[test]
    fn test_templating_static_and_dynamic() {
        let mut vars = HashMap::new();
        vars.insert("base_token".into(), "secret123".into());
        let resolver = TemplateResolver::from_map(vars);

        let input = "Bearer {{base_token}} with {{uuid}} and {{random_phone}} and {{random_int:10:20}}";
        let resolved = resolver.resolve_str(input, None);
        assert!(resolved.starts_with("Bearer secret123 with "));
        assert!(resolved.contains("+62812"));
        assert!(!resolved.contains("{{base_token}}"));
        assert!(!resolved.contains("{{uuid}}"));

        // Test overlay
        let mut overlay = HashMap::new();
        overlay.insert("base_token".into(), "override_token".into());
        let overlaid = resolver.resolve_str("Bearer {{base_token}}", Some(&overlay));
        assert_eq!(overlaid, "Bearer override_token");
    }

    #[test]
    fn test_assertions_dig_and_evaluation() {
        let body_json = json!({
            "status": "success",
            "data": {
                "items": [
                    {"id": 101, "name": "Alice"},
                    {"id": 102, "name": "Bob"}
                ]
            }
        });

        assert_eq!(dig(&body_json, "body.data.items.0.name").unwrap(), &json!("Alice"));
        assert_eq!(dig(&body_json, "data.items.-1.name").unwrap(), &json!("Bob"));

        let mut headers = HashMap::new();
        headers.insert("content-type".into(), "application/json".into());

        let ctx = ExecutionResponseContext {
            status: 200,
            time_ms: 45.0,
            body: r#"{"status":"success"}"#,
            json: Some(&body_json),
            headers: &headers,
        };

        let assertions = vec![
            json!({"type": "status", "op": "eq", "value": 200}),
            json!({"type": "time_ms", "op": "lt", "value": 100}),
            json!({"type": "jsonpath", "path": "data.items.0.id", "op": "eq", "value": 101}),
            json!({"type": "header", "name": "Content-Type", "op": "contains", "value": "json"}),
        ];

        let results = evaluate_assertions(&assertions, &ctx);
        assert_eq!(results.len(), 4);
        assert!(results.iter().all(|r| r.ok));
    }

    #[test]
    fn test_extractors_body_and_cookie() {
        let mut ep = EndpointTest::new(None, "Login".into(), "/login".into(), None);
        ep.extractors.insert("token".into(), "body.auth.jwt".into());
        ep.extractors.insert("session_id".into(), "cookie".into());

        let body = json!({"auth": {"jwt": "jwt_token_abc"}});
        let mut headers = HashMap::new();
        headers.insert("Set-Cookie".into(), "session_id=sess_999; Path=/; HttpOnly".into());

        let mut variables = HashMap::new();
        let changed = ResponseExtractor::apply(&ep, Some(&body), &headers, &mut variables);

        assert_eq!(changed.len(), 2);
        assert_eq!(variables.get("token").unwrap(), "jwt_token_abc");
        assert_eq!(variables.get("session_id").unwrap(), "sess_999");
    }

    #[test]
    fn test_metrics_percentiles_and_rps() {
        let metrics = RunMetrics::new();
        metrics.record_response(200, 10.0, false, None);
        metrics.record_response(200, 20.0, false, None);
        metrics.record_response(429, 30.0, true, Some("60".into()));
        metrics.record_response(500, 40.0, false, None);

        let snap = metrics.snapshot();
        assert_eq!(snap.attempts, 4);
        assert_eq!(snap.success, 2);
        assert_eq!(snap.rate_limited, 1);
        assert_eq!(snap.errors, 1);
        assert_eq!(snap.first_rate_limited_at, Some(3));
        assert_eq!(snap.retry_after, Some("60".into()));
        assert!(snap.latency_ms.avg >= 20);
    }

    #[test]
    fn test_transport_resolve_target() {
        assert_eq!(resolve_target("https://api.test", "users"), "https://api.test/users");
        assert_eq!(resolve_target("https://api.test/", "/users"), "https://api.test/users");
        assert_eq!(resolve_target("https://api.test", "https://other.test/path"), "https://other.test/path");
        assert_eq!(resolve_target("https://api.test", "ws://localhost:9000"), "ws://localhost:9000");
    }

    #[tokio::test]
    async fn test_api_tester_instantiation_and_stopping() {
        let ep = EndpointTest::new(None, "Ping".into(), "/ping".into(), Some("GET".into()));
        let config = TestConfig::new("https://127.0.0.1:9999".into(), HashMap::new(), vec![ep.clone()]);
        let tester = APITester::new(ep, config, 2, 0, 10, None);

        assert!(!tester.is_stopped());
        tester.stop();
        assert!(tester.is_stopped());

        let snap = tester.metrics.snapshot();
        assert_eq!(snap.attempts, 0);
    }
}

