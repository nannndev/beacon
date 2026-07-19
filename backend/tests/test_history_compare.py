import unittest

from backend.app.history.compare import compare_details, percentile


def detail(p95, errors, success, rps, samples=None):
    return {
        "id": f"run-{p95}",
        "metrics": {
            "p95_ms": p95,
            "errors": errors,
            "success": success,
            "average_rps": rps,
        },
        "samples": samples or [],
        "config_snapshot": {"concurrency": 1},
    }


class HistoryCompareTests(unittest.TestCase):
    def test_percentile_is_stable_and_does_not_mutate_input(self):
        values = [30, 10, 20, 40]
        self.assertEqual(percentile(values, 0.5), 25)
        self.assertEqual(percentile(values, 0.95), 38.5)
        self.assertEqual(values, [30, 10, 20, 40])
        self.assertIsNone(percentile([], 0.95))

    def test_compare_uses_metric_direction_semantics(self):
        result = compare_details(
            detail(p95=400, errors=5, success=95, rps=20),
            detail(p95=300, errors=2, success=98, rps=25),
        )

        self.assertEqual(result["deltas"]["p95_ms"]["change"], -100)
        self.assertTrue(result["deltas"]["p95_ms"]["improved"])
        self.assertTrue(result["deltas"]["average_rps"]["improved"])

    def test_series_stops_at_shorter_run(self):
        baseline = detail(10, 0, 1, 1, [
            {"elapsed_ms": 100, "instantaneous_rps": 1},
            {"elapsed_ms": 200, "instantaneous_rps": 2},
            {"elapsed_ms": 300, "instantaneous_rps": 3},
        ])
        candidate = detail(10, 0, 1, 1, [
            {"elapsed_ms": 100, "instantaneous_rps": 2},
            {"elapsed_ms": 210, "instantaneous_rps": 3},
        ])

        aligned = compare_details(baseline, candidate)["series"]

        self.assertEqual(len(aligned), 2)
        self.assertLessEqual(aligned[-1]["elapsed_ms"], 210)


if __name__ == "__main__":
    unittest.main()
