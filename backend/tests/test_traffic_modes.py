"""Behavioral coverage for the traffic modes exposed by run_mode().

`capacity` is covered separately in test_capacity_mode.py. These tests pin the
observable contract of the remaining modes — how many requests each one sends,
the phase/step shape it walks through, and how it reports a threshold — without
touching the network. Each test replaces `_send_one` with a recorder so the
scheduling logic itself is what gets exercised.
"""
import threading
import unittest

from backend.app.core.tester import APITester, EndpointTest, TestConfig


def _tester(**kwargs):
    snapshots = []
    tester = APITester(
        EndpointTest("t1", "Target", "https://example.test"),
        TestConfig(),
        stats_callback=snapshots.append,
        **kwargs,
    )
    tester.log = lambda *args, **kwargs: None
    return tester, snapshots


def _record_sends(tester, rate_limited_from=None, latency_ms=10.0):
    """Replace _send_one with a thread-safe recorder that keeps metrics honest."""
    sent = []
    lock = threading.Lock()

    def fake_send(attempt):
        with lock:
            sent.append(attempt)
            position = len(sent)
        limited = rate_limited_from is not None and position >= rate_limited_from
        with tester._lock:
            tester.metrics.record_response(429 if limited else 200, latency_ms, limited)
        return {"attempt": attempt, "success": not limited, "rate_limited": limited}

    tester._send_one = fake_send
    return sent


class LoadModeTests(unittest.TestCase):
    def test_load_sends_exactly_max_requests_sequentially(self):
        tester, _ = _tester(concurrency=1, delay=0, max_requests=7)
        sent = _record_sends(tester)

        results = tester.run_mode("load")

        self.assertEqual(len(sent), 7)
        self.assertEqual(sorted(sent), list(range(1, 8)))
        self.assertEqual(results["attempts"], 7)

    def test_load_under_concurrency_still_sends_each_index_once(self):
        tester, _ = _tester(concurrency=8, delay=0, max_requests=50)
        sent = _record_sends(tester)

        tester.run_mode("load")

        self.assertEqual(sorted(sent), list(range(1, 51)))

    def test_stop_flag_halts_the_run_early(self):
        stop = {"stop": False}
        tester, _ = _tester(concurrency=1, delay=0, max_requests=100)
        tester.stop_flag = stop
        original = _record_sends(tester)
        inner = tester._send_one

        def stopping_send(attempt):
            if attempt >= 5:
                stop["stop"] = True
            return inner(attempt)

        tester._send_one = stopping_send
        tester.run_mode("load")

        self.assertLess(len(original), 100)
        self.assertGreaterEqual(len(original), 5)

    def test_unknown_mode_falls_back_to_load(self):
        tester, _ = _tester(concurrency=1, delay=0, max_requests=3)
        sent = _record_sends(tester)

        tester.run_mode("does-not-exist")

        self.assertEqual(len(sent), 3)


class RampModeTests(unittest.TestCase):
    def test_ramp_caps_at_max_requests_and_grows_workers(self):
        tester, _ = _tester()
        sent = _record_sends(tester)

        results = tester.run_mode("ramp", {
            "ramp_start": 1, "ramp_end": 8,
            "ramp_step_duration": 0, "max_requests": 20, "delay": 0,
        })

        # The ramp must never overshoot its budget, even while doubling workers.
        self.assertEqual(len(sent), 20)
        self.assertEqual(sorted(sent), list(range(1, 21)))
        self.assertEqual(results["attempts"], 20)

    def test_ramp_never_exceeds_budget_when_batch_is_larger_than_remainder(self):
        tester, _ = _tester()
        sent = _record_sends(tester)

        tester.run_mode("ramp", {
            "ramp_start": 16, "ramp_end": 16,
            "ramp_step_duration": 0, "max_requests": 5, "delay": 0,
        })

        self.assertEqual(len(sent), 5)


class SpikeModeTests(unittest.TestCase):
    def test_spike_runs_all_three_phases_in_order(self):
        tester, _ = _tester()
        sent = _record_sends(tester)

        results = tester.run_mode("spike", {
            "baseline_workers": 2, "peak_workers": 4,
            "baseline_requests": 3, "peak_requests": 6,
            "recovery_requests": 2, "delay": 0,
        })

        # baseline + peak + recovery, numbered continuously across phases.
        self.assertEqual(len(sent), 3 + 6 + 2)
        self.assertEqual(sorted(sent), list(range(1, 12)))
        self.assertEqual(results["attempts"], 11)


class SoakModeTests(unittest.TestCase):
    def test_soak_stops_at_the_deadline(self):
        tester, _ = _tester()
        sent = _record_sends(tester)

        results = tester.run_mode("soak", {
            "duration_s": 0.3, "rps": 200.0, "concurrency": 1,
        })

        self.assertGreater(len(sent), 0)
        self.assertEqual(results["attempts"], len(sent))

    def test_soak_honours_the_stop_flag(self):
        stop = {"stop": False}
        tester, _ = _tester()
        tester.stop_flag = stop
        _record_sends(tester)
        inner = tester._send_one

        def stopping_send(attempt):
            result = inner(attempt)
            stop["stop"] = True
            return result

        tester._send_one = stopping_send
        results = tester.run_mode("soak", {"duration_s": 30.0, "rps": 100.0, "concurrency": 1})

        # Must exit on the flag rather than running the full 30s duration.
        self.assertEqual(results["attempts"], 1)


class RateProbeModeTests(unittest.TestCase):
    def test_probe_records_the_rps_where_throttling_starts(self):
        tester, snapshots = _tester()
        # Healthy for the first step, throttled inside the second.
        _record_sends(tester, rate_limited_from=5)

        tester.run_mode("rate_probe", {
            "start_rps": 100.0, "step_rps": 100.0,
            "step_requests": 4, "max_rps": 500.0,
        })

        self.assertEqual(tester.metrics.probe_threshold_rps, 200.0)
        self.assertEqual(snapshots[-1]["probe_threshold_rps"], 200.0)

    def test_probe_reports_no_threshold_when_never_throttled(self):
        tester, _ = _tester()
        _record_sends(tester)

        tester.run_mode("rate_probe", {
            "start_rps": 100.0, "step_rps": 100.0,
            "step_requests": 2, "max_rps": 300.0,
        })

        self.assertIsNone(tester.metrics.probe_threshold_rps)


class FuzzModeTests(unittest.TestCase):
    def test_fuzz_injects_values_and_restores_the_original_payload(self):
        original_payload = {"username": "real", "keep": "untouched"}
        tester = APITester(
            EndpointTest("f1", "Fuzz", "https://example.test", "POST",
                         payload=dict(original_payload)),
            TestConfig(),
        )
        tester.log = lambda *args, **kwargs: None
        seen = []

        def capture(attempt):
            seen.append(dict(tester.test.payload))
            with tester._lock:
                tester.metrics.record_response(200, 5.0, False)
            return {"attempt": attempt, "success": True}

        tester._send_one = capture
        tester.run_mode("fuzz", {
            "fuzz_fields": {"username": "real"},
            "fuzz_types": {"username": "sql"},
            "max_requests": 4, "concurrency": 1, "delay": 0,
        })

        self.assertEqual(len(seen), 4)
        # Every request carried an injected value, not the original.
        self.assertTrue(all(payload["username"] != "real" for payload in seen))
        # Non-fuzzed fields survive untouched.
        self.assertTrue(all(payload["keep"] == "untouched" for payload in seen))
        # SQL payloads cycle rather than repeating one value.
        self.assertGreater(len({payload["username"] for payload in seen}), 1)
        # The endpoint definition is restored after the run.
        self.assertEqual(tester.test.payload, original_payload)

    def test_fuzz_leaves_unlisted_fields_alone(self):
        tester = APITester(
            EndpointTest("f2", "Fuzz", "https://example.test", "POST",
                         payload={"a": "1", "b": "2"}),
            TestConfig(),
        )
        tester.log = lambda *args, **kwargs: None
        seen = []

        def capture(attempt):
            seen.append(dict(tester.test.payload))
            with tester._lock:
                tester.metrics.record_response(200, 5.0, False)
            return {"attempt": attempt, "success": True}

        tester._send_one = capture
        tester.run_mode("fuzz", {
            "fuzz_fields": {"a": "1"}, "fuzz_types": {"a": "empty"},
            "max_requests": 1, "concurrency": 1, "delay": 0,
        })

        self.assertEqual(seen[0]["a"], "")
        self.assertEqual(seen[0]["b"], "2")


class BenchmarkModeTests(unittest.TestCase):
    def test_benchmark_discards_warmup_from_reported_metrics(self):
        tester, _ = _tester()
        sent = _record_sends(tester)

        results = tester.run_mode("benchmark", {"n_samples": 6, "warmup": 3})

        # Warmup requests are really sent, but must not pollute the sample set.
        self.assertEqual(len(sent), 9)
        self.assertEqual(results["attempts"], 6)

    def test_benchmark_reports_percentiles_over_samples_only(self):
        tester, snapshots = _tester()
        _record_sends(tester, latency_ms=40.0)

        tester.run_mode("benchmark", {"n_samples": 5, "warmup": 2})

        self.assertEqual(snapshots[-1]["latency_ms"]["p50"], 40)
        self.assertEqual(len(tester.metrics.all_latencies), 5)


if __name__ == "__main__":
    unittest.main()
