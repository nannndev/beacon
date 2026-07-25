from backend.app.core.tester import APITester, EndpointTest, TestConfig as BeaconConfig


def test_capacity_reports_last_safe_rps_and_breaking_reason():
    snapshots = []
    tester = APITester(
        EndpointTest("capacity", "Capacity target", "https://example.test"),
        BeaconConfig(),
        stats_callback=snapshots.append,
    )

    def fake_send(attempt):
        healthy = attempt <= 3
        with tester._lock:
            tester.results["attempts"] += 1
            if healthy:
                tester.results["success"] += 1
            else:
                tester.results["errors"] += 1
            tester._record_latency(20 if healthy else 120)
        return {"attempt": attempt, "success": healthy}

    tester._send_one = fake_send
    tester.run_capacity(
        start_rps=1000,
        step_rps=1000,
        step_requests=3,
        max_rps=2000,
        p95_limit_ms=50,
        error_limit_pct=0,
        success_min_pct=100,
    )

    final = snapshots[-1]
    assert final["capacity_safe_rps"] == 1000
    assert final["capacity_breaking_rps"] == 2000
    assert "p95 120ms > 50ms" in final["capacity_breach_reason"]
    assert "errors 100.0% > 0.0%" in final["capacity_breach_reason"]
