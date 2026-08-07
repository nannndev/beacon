import contextlib
import json
import requests
import time
import random
import string
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Callable, Optional, Any

from .assertions import evaluate_assertions
from .auth import effective_auth, resolve_auth_headers
from .extractors import ResponseExtractor
from .metrics import RunMetrics, percentile
from .models import EndpointTest, TestConfig
from .templating import TemplateResolver
from .transport import HttpTransport, WebSocketTransport

class APITester:
    def __init__(self, test: EndpointTest, config: TestConfig,
                 concurrency: int = 1, delay: float = 0.1, max_requests: int = 100,
                 log_callback: Callable[[str], None] = None,
                 stats_callback: Callable[[Dict], None] = None,
                 response_callback: Callable[[Dict], None] = None,
                 stop_flag: Optional[Dict] = None):
        self.test = test
        self.config = config
        self.concurrency = max(1, concurrency)
        self.delay = delay
        self.max_requests = max_requests
        self.log = log_callback or print
        self.update_stats = stats_callback or (lambda x: None)
        self.emit_response = response_callback or (lambda x: None)
        self.stop_flag = stop_flag or {"stop": False}
        # Per-thread HTTP sessions. A single requests.Session shared across the
        # ThreadPoolExecutor workers is not thread-safe (its cookie jar and
        # header dict race), which corrupts state under concurrency > 1.
        self._tls = threading.local()
        self._lock = threading.Lock()
        self.metrics = RunMetrics()
        self.templates = TemplateResolver(config.variables, getattr(config, "variables_lock", None))
        self.transport = HttpTransport()
        self.ws_transport = WebSocketTransport()
        self.extractor = ResponseExtractor()

    @property
    def results(self):
        """Compatibility view while callers migrate to RunMetrics snapshots."""
        return self.metrics.results

    def _session(self) -> "requests.Session":
        s = getattr(self._tls, "session", None)
        if s is None:
            s = requests.Session()
            self._tls.session = s
        return s

    def _reset_metrics(self):
        self.metrics.reset()

    def _record_latency(self, ms: float):
        self.metrics.record_latency(ms)

    @staticmethod
    def _percentile(sorted_vals: List[float], pct: float) -> float:
        return percentile(sorted_vals, pct)

    def _snapshot(self) -> Dict:
        return self.metrics.snapshot()

    def _substitute(self, value: Any) -> Any:
        return self.templates.resolve(value)

    def _generate_dynamic(self, spec: str) -> str:
        return self.templates.generate(spec)

    def _variables_lock(self):
        """The config's guard, or a no-op for configs built before it existed."""
        return getattr(self.config, "variables_lock", None) or contextlib.nullcontext()

    def _extract_from_response(self, resp):
        # Hold the same guard templating reads under: concurrent workers must
        # not add a variable while another is resolving its request.
        with self._variables_lock():
            return self.extractor.apply(self.test, resp, self.config.variables, self.log)

    def _auth_headers(self) -> Dict:
        """Headers from the resolved auth spec: project → folder(s) → endpoint.

        Encoding happens here, after templating, so Basic credentials can live
        in environment variables instead of a pre-encoded blob.
        """
        chain = [*getattr(self.test, "inherited_auth", []), getattr(self.test, "auth", None)]
        return resolve_auth_headers(effective_auth(*chain), self._substitute)

    def _build_request(self):
        url = self._substitute(self.test.url)
        if not url.startswith("http"):
            url = self.config.base_url.rstrip("/") + "/" + url.lstrip("/")

        headers = {k: self._substitute(v) for k, v in self.test.headers.items()}
        # A configured auth spec is authoritative over a hand-written header,
        # so switching auth types cannot leave a stale Authorization behind.
        headers.update(self._auth_headers())

        # Substitute inside payload (supports nested if present)
        raw_payload = self.test.payload or {}
        payload = self._substitute(raw_payload)

        return url, headers, payload

    def _do_request(self, session, url, headers, payload, timeout: int = 10):
        return self.transport.send(session, self.test, url, headers, payload, timeout)

    def send_once(self, max_body: int = 262144, retries: int = 0, retry_delay: float = 0.0) -> Dict:
        """Fire a single request and return the full response for inspection
        (status, timing, headers, body). Applies templating and, on a 2xx,
        runs extractors just like a run — so 'Send login' refreshes tokens.
        Evaluates the endpoint's assertions against the response. Retries up to
        `retries` times (waiting `retry_delay`s between tries) while the request
        errors or returns a non-2xx. Never raises: errors come back as
        {ok: False, error: ...}."""
        url, headers, payload = self._build_request()
        total = max(0, int(retries)) + 1

        for attempt in range(1, total + 1):
            last = attempt == total
            start = time.time()
            try:
                resp = self._do_request(self._session(), url, headers, payload, timeout=30)
            except Exception as e:
                if last:
                    return {"ok": False, "error": str(e), "target": url,
                            "time_ms": round((time.time() - start) * 1000), "attempts": attempt}
                if retry_delay:
                    time.sleep(retry_delay)
                continue

            is_success = 200 <= resp.status_code < 300
            if not is_success and not last:
                if retry_delay:
                    time.sleep(retry_delay)
                continue

            elapsed_ms = round((time.time() - start) * 1000)
            text = resp.text or ""
            ctype = resp.headers.get("content-type", "")
            parsed = None
            if "application/json" in ctype.lower():
                try:
                    parsed = resp.json()
                except Exception:
                    parsed = None

            extracted: List[str] = []
            if is_success and getattr(self.test, "extractors", None):
                # Compare under one guard so a concurrent extractor cannot
                # resize the mapping between the before/after reads.
                with self._variables_lock():
                    before = dict(self.config.variables)
                    self.extractor.apply(self.test, resp, self.config.variables, self.log)
                    extracted = [k for k, v in self.config.variables.items() if before.get(k) != v]

            result = {
                "ok": True,
                "status": resp.status_code,
                "reason": getattr(resp, "reason", "") or "",
                "time_ms": elapsed_ms,
                "size_bytes": len(resp.content or b""),
                "truncated": len(text) > max_body,
                "content_type": ctype,
                "headers": dict(resp.headers),
                "body": text[:max_body],
                "json": parsed,
                "target": url,
                "final_url": getattr(resp, "url", url) or url,
                "redirects": len(getattr(resp, "history", []) or []),
                "ttfb_ms": round(getattr(resp, "elapsed", 0).total_seconds() * 1000)
                if hasattr(getattr(resp, "elapsed", None), "total_seconds") else elapsed_ms,
                "target_type": getattr(self.test, "target_type", "api"),
                "extracted": extracted,
                "attempts": attempt,
            }
            result["assertions"] = evaluate_assertions(getattr(self.test, "assertions", None), result)
            result["passed"] = (all(a["ok"] for a in result["assertions"])
                                if result["assertions"] else None)
            return result

    def _send_one(self, i: int) -> Dict:
        if self.stop_flag.get("stop"):
            return {"status": "stopped"}

        url, headers, payload = self._build_request()

        start = time.time()
        try:
            session = self._session()
            resp = self._do_request(session, url, headers, payload, timeout=10)

            elapsed = time.time() - start
            is_success = 200 <= resp.status_code < 300
            retry_after = resp.headers.get("Retry-After")
            # Accurate throttle detection: prefer HTTP 429 / Retry-After, then
            # fall back to specific phrases. Avoid a bare "rate" substring — it
            # matches innocent words like "generate"/"accurate" and inflates the
            # rate_limited count that defense-validation runs depend on.
            text_lc = resp.text.lower()
            is_rate = (
                resp.status_code == 429
                or "rate limit" in text_lc
                or "ratelimit" in text_lc
                or "too many request" in text_lc
                or "too many attempt" in text_lc
            )

            with self._lock:
                self.metrics.record_response(resp.status_code, elapsed * 1000.0, is_rate, retry_after)
                snapshot = self._snapshot()

            # === Process extractors (for fresh tokens from login/onboarding etc) ===
            if is_success and getattr(self.test, 'extractors', None):
                self._extract_from_response(resp)

            result = {
                "attempt": i,
                "method": self.test.method,
                "url": url,
                "status": resp.status_code,
                "time": round(elapsed, 3),
                "success": is_success,
                "rate_limited": is_rate,
                "retry_after": retry_after,
                "size_bytes": len(resp.content or b""),
                "final_url": getattr(resp, "url", url) or url,
                "redirects": len(getattr(resp, "history", []) or []),
                "target_type": getattr(self.test, "target_type", "api"),
                "body": resp.text[:50000],
            }

            self.update_stats(snapshot)
            self.emit_response(result)
            self.log(f"[{i}] {self.test.name} {url} -> {resp.status_code} ({elapsed:.2f}s) {'SUCCESS' if is_success else 'FAIL'}")

            return result
        except Exception as e:
            with self._lock:
                self.metrics.record_error()
                snapshot = self._snapshot()
            self.update_stats(snapshot)
            err = {
                "attempt": i,
                "method": self.test.method,
                "url": url,
                "error": str(e),
                "success": False,
            }
            self.emit_response(err)
            self.log(f"[{i}] ERROR: {str(e)}")
            return err

    def run(self):
        """Standard load run: fixed concurrency, fixed request count."""
        self._reset_metrics()
        self.update_stats(self._snapshot())

        if self.concurrency > 1:
            with ThreadPoolExecutor(max_workers=self.concurrency) as executor:
                futures = []
                for i in range(1, self.max_requests + 1):
                    if self.stop_flag.get("stop"):
                        break
                    futures.append(executor.submit(self._send_one, i))
                    if self.delay > 0:
                        time.sleep(self.delay)  # throttle submissions
                for f in as_completed(futures):
                    if self.stop_flag.get("stop"):
                        break
        else:
            for i in range(1, self.max_requests + 1):
                if self.stop_flag.get("stop"):
                    break
                self._send_one(i)
                if self.delay > 0:
                    time.sleep(self.delay)

        self.log(f"Finished. {self.metrics.results}")
        return self.metrics.results

    # -------------------------------------------------------------------------
    # RAMP mode: gradually double workers every ramp_step_duration seconds
    # -------------------------------------------------------------------------
    def run_ramp(self, ramp_start: int = 1, ramp_end: int = 16,
                 ramp_step_duration: float = 10.0, max_requests: int = 500,
                 delay: float = 0.05):
        """Gradually ramp up concurrency. Start at ramp_start workers, double
        every ramp_step_duration seconds until ramp_end, submitting requests
        up to max_requests total."""
        self._reset_metrics()
        self.update_stats(self._snapshot())
        counter = [0]  # shared mutable int
        counter_lock = threading.Lock()

        current_workers = max(1, ramp_start)
        self.log(f"[ramp] Starting ramp: {current_workers} -> {ramp_end} workers, "
                 f"step={ramp_step_duration}s, max_requests={max_requests}")

        def _next_idx():
            with counter_lock:
                counter[0] += 1
                return counter[0]

        with ThreadPoolExecutor(max_workers=max(ramp_end, 1)) as executor:
            step_deadline = time.time() + ramp_step_duration
            while True:
                if self.stop_flag.get("stop"):
                    break
                with counter_lock:
                    total_so_far = counter[0]
                if total_so_far >= max_requests:
                    break

                # Ramp up workers on schedule
                now = time.time()
                if now >= step_deadline and current_workers < ramp_end:
                    current_workers = min(current_workers * 2, ramp_end)
                    self.log(f"[ramp] Workers increased to {current_workers}")
                    step_deadline = now + ramp_step_duration

                # Submit a batch equal to current_workers
                futures_batch = []
                for _ in range(current_workers):
                    with counter_lock:
                        if counter[0] >= max_requests:
                            break
                        counter[0] += 1
                        idx = counter[0]
                    if self.stop_flag.get("stop"):
                        break
                    futures_batch.append(executor.submit(self._send_one, idx))

                for f in as_completed(futures_batch):
                    if self.stop_flag.get("stop"):
                        break

                if delay > 0:
                    time.sleep(delay)

        self.log(f"[ramp] Finished. workers reached={current_workers}. {self.metrics.results}")
        return self.metrics.results

    # -------------------------------------------------------------------------
    # SPIKE mode: baseline -> peak -> recovery (3 phases)
    # -------------------------------------------------------------------------
    def run_spike(self, baseline_workers: int = 2, peak_workers: int = 20,
                  baseline_requests: int = 50, peak_requests: int = 200,
                  recovery_requests: int = 50, delay: float = 0.05):
        """3-phase spike: baseline load, sudden peak, then recovery."""
        self._reset_metrics()
        self.update_stats(self._snapshot())

        phases = [
            ("baseline", baseline_workers, baseline_requests),
            ("peak",     peak_workers,     peak_requests),
            ("recovery", baseline_workers, recovery_requests),
        ]
        global_i = [0]

        for phase_name, workers, n_req in phases:
            if self.stop_flag.get("stop"):
                break
            self.log(f"[spike] === Phase: {phase_name} | workers={workers} | requests={n_req} ===")
            with ThreadPoolExecutor(max_workers=max(workers, 1)) as executor:
                futures = []
                for _ in range(n_req):
                    if self.stop_flag.get("stop"):
                        break
                    global_i[0] += 1
                    futures.append(executor.submit(self._send_one, global_i[0]))
                    if delay > 0:
                        time.sleep(delay)
                for f in as_completed(futures):
                    if self.stop_flag.get("stop"):
                        break
            self.log(f"[spike] Phase {phase_name} complete. Running stats: {self.metrics.results}")

        self.log(f"[spike] Finished. {self.metrics.results}")
        return self.metrics.results

    # -------------------------------------------------------------------------
    # SOAK mode: time-based run at a fixed RPS
    # -------------------------------------------------------------------------
    def run_soak(self, duration_s: float = 300.0, rps: float = 5.0,
                 concurrency: int = 1):
        """Run for a fixed wall-clock duration at a target RPS. Logs throughput
        summary every 10 seconds."""
        self._reset_metrics()
        self.update_stats(self._snapshot())

        interval = 1.0 / max(rps, 0.001)  # seconds between submissions
        deadline = time.time() + duration_s
        next_log = time.time() + 10.0
        i = 0

        self.log(f"[soak] Starting: duration={duration_s}s rps={rps} concurrency={concurrency}")

        if concurrency > 1:
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures_running: list = []
                while time.time() < deadline and not self.stop_flag.get("stop"):
                    i += 1
                    futures_running.append(executor.submit(self._send_one, i))
                    # Prune completed futures to avoid memory growth
                    futures_running = [f for f in futures_running if not f.done()]

                    now = time.time()
                    if now >= next_log:
                        snap = self._snapshot()
                        self.log(f"[soak] t={round(now - self.metrics.started_at)}s "
                                 f"attempts={snap['attempts']} rps={snap['rps']} "
                                 f"success={snap['success']} rl={snap['rate_limited']}")
                        next_log = now + 10.0

                    sleep_until = time.time() + interval
                    remaining = sleep_until - time.time()
                    if remaining > 0:
                        time.sleep(remaining)

                for f in as_completed(futures_running):
                    pass  # drain
        else:
            while time.time() < deadline and not self.stop_flag.get("stop"):
                i += 1
                self._send_one(i)

                now = time.time()
                if now >= next_log:
                    snap = self._snapshot()
                    self.log(f"[soak] t={round(now - self.metrics.started_at)}s "
                             f"attempts={snap['attempts']} rps={snap['rps']} "
                             f"success={snap['success']} rl={snap['rate_limited']}")
                    next_log = now + 10.0

                sleep_until = time.time() + interval
                remaining = sleep_until - time.time()
                if remaining > 0:
                    time.sleep(remaining)

        snap = self._snapshot()
        self.log(f"[soak] Finished. duration={round(snap['elapsed_s'])}s "
                 f"attempts={snap['attempts']} avg_rps={snap['rps']}")
        return self.metrics.results

    # -------------------------------------------------------------------------
    # RATE PROBE mode: auto-escalate RPS until 429
    # -------------------------------------------------------------------------
    def run_rate_probe(self, start_rps: float = 1.0, step_rps: float = 1.0,
                       step_requests: int = 20, max_rps: float = 100.0):
        """Probe the server's rate-limit threshold by incrementally increasing
        RPS. Stops when a 429 is encountered and stores the threshold."""
        self._reset_metrics()
        self.update_stats(self._snapshot())
        self.metrics.probe_threshold_rps = None

        current_rps = start_rps
        i = 0
        self.log(f"[probe] Starting rate probe: {start_rps} -> {max_rps} rps, "
                 f"step={step_rps}, step_requests={step_requests}")

        while current_rps <= max_rps and not self.stop_flag.get("stop"):
            interval = 1.0 / max(current_rps, 0.001)
            step_rl_before = self.metrics.results["rate_limited"]
            self.log(f"[probe] Testing at {current_rps:.1f} rps ...")

            for _ in range(step_requests):
                if self.stop_flag.get("stop"):
                    break
                i += 1
                self._send_one(i)
                time.sleep(interval)

            step_rl_after = self.metrics.results["rate_limited"]
            if step_rl_after > step_rl_before:
                # Rate limit hit
                self.metrics.probe_threshold_rps = current_rps
                self.log(f"[probe] Rate limit threshold found at {current_rps:.1f} rps")
                self.update_stats(self._snapshot())
                break
            else:
                self.log(f"[probe] No rate limit at {current_rps:.1f} rps. Stepping up.")
                current_rps = round(current_rps + step_rps, 3)
                self.update_stats(self._snapshot())

        if self.metrics.probe_threshold_rps is None and not self.stop_flag.get("stop"):
            self.log(f"[probe] No rate limit detected up to {max_rps:.1f} rps")

        self.log(f"[probe] Finished. threshold={self.metrics.probe_threshold_rps} rps. {self.metrics.results}")
        return self.metrics.results

    # -------------------------------------------------------------------------
    # CAPACITY mode: find the highest RPS that still satisfies the SLO
    # -------------------------------------------------------------------------
    def run_capacity(self, start_rps: float = 5.0, step_rps: float = 5.0,
                     step_requests: int = 30, max_rps: float = 200.0,
                     p95_limit_ms: float = 500.0, error_limit_pct: float = 1.0,
                     success_min_pct: float = 99.0):
        """Increase target RPS step-by-step until a latency or reliability SLO
        is breached. Each decision uses only samples from the current step."""
        self._reset_metrics()
        self.update_stats(self._snapshot())
        current_rps = max(0.1, start_rps)
        step_rps = max(0.1, step_rps)
        step_requests = max(1, step_requests)
        request_index = 0
        max_workers = max(2, min(256, int(max_rps) + 1))

        self.log(
            f"[capacity] Starting {current_rps:.1f} -> {max_rps:.1f} rps; "
            f"SLO p95<={p95_limit_ms:.0f}ms errors<={error_limit_pct:.1f}% "
            f"success>={success_min_pct:.1f}%"
        )

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            while current_rps <= max_rps and not self.stop_flag.get("stop"):
                before = dict(self.metrics.results)
                latency_offset = len(self.metrics.all_latencies)
                futures = []
                interval = 1.0 / current_rps
                next_submit = time.monotonic()
                self.log(f"[capacity] Testing {current_rps:.1f} rps ({step_requests} requests) ...")

                for _ in range(step_requests):
                    if self.stop_flag.get("stop"):
                        break
                    remaining = next_submit - time.monotonic()
                    if remaining > 0:
                        time.sleep(remaining)
                    request_index += 1
                    futures.append(executor.submit(self._send_one, request_index))
                    next_submit += interval

                for future in as_completed(futures):
                    future.result()

                attempts = self.metrics.results["attempts"] - before["attempts"]
                successes = self.metrics.results["success"] - before["success"]
                failures = ((self.metrics.results["errors"] - before["errors"])
                            + (self.metrics.results["rate_limited"] - before["rate_limited"]))
                step_latencies = sorted(self.metrics.all_latencies[latency_offset:])
                p95 = self._percentile(step_latencies, 95)
                error_pct = (failures / attempts * 100.0) if attempts else 100.0
                success_pct = (successes / attempts * 100.0) if attempts else 0.0

                reasons = []
                if p95 > p95_limit_ms:
                    reasons.append(f"p95 {p95:.0f}ms > {p95_limit_ms:.0f}ms")
                if error_pct > error_limit_pct:
                    reasons.append(f"errors {error_pct:.1f}% > {error_limit_pct:.1f}%")
                if success_pct < success_min_pct:
                    reasons.append(f"success {success_pct:.1f}% < {success_min_pct:.1f}%")

                self.log(
                    f"[capacity] {current_rps:.1f} rps result: p95={p95:.0f}ms "
                    f"errors={error_pct:.1f}% success={success_pct:.1f}%"
                )
                if reasons:
                    self.metrics.capacity_breaking_rps = current_rps
                    self.metrics.capacity_breach_reason = "; ".join(reasons)
                    self.log(f"[capacity] Breaking point: {current_rps:.1f} rps — {self.metrics.capacity_breach_reason}")
                    self.update_stats(self._snapshot())
                    break

                self.metrics.capacity_safe_rps = current_rps
                self.update_stats(self._snapshot())
                current_rps = round(current_rps + step_rps, 3)

        if self.metrics.capacity_breaking_rps is None and not self.stop_flag.get("stop"):
            self.log(f"[capacity] SLO remained healthy through {self.metrics.capacity_safe_rps or 0:.1f} rps")
        self.update_stats(self._snapshot())
        self.log(
            f"[capacity] Finished. safe={self.metrics.capacity_safe_rps} rps, "
            f"breaking={self.metrics.capacity_breaking_rps} rps"
        )
        return self.metrics.results

    # -------------------------------------------------------------------------
    # FUZZ mode: mutate payload fields with various fuzz values
    # -------------------------------------------------------------------------
    _SQL_PAYLOADS = [
        "' OR 1=1--",
        "'; DROP TABLE users;--",
        "1' OR '1'='1",
        "admin'--",
    ]
    _XSS_PAYLOADS = [
        "<script>alert(1)</script>",
        "javascript:alert(1)",
        "<img src=x onerror=alert(1)>",
        "'\"<svg/onload=alert(1)>",
    ]

    def _fuzz_payload(self, fuzz_fields: Dict[str, str],
                      fuzz_types: Dict[str, str],
                      _counters: Dict[str, int]) -> Dict:
        """Build a dict of fuzz values for the given fields.
        _counters is a mutable dict used to cycle through sequence payloads."""
        result = {}
        for field, ftype in fuzz_types.items():
            if field not in fuzz_fields:
                continue
            ftype = ftype.lower()
            if ftype == "string":
                chars = string.ascii_letters + string.digits
                result[field] = ''.join(random.choice(chars) for _ in range(8))
            elif ftype == "number":
                result[field] = random.randint(0, 99999)
            elif ftype == "email":
                result[field] = f"fuzz{random.randint(100000,9999999)}@fuzz.test"
            elif ftype == "sql":
                idx = _counters.get(field, 0) % len(self._SQL_PAYLOADS)
                result[field] = self._SQL_PAYLOADS[idx]
                _counters[field] = idx + 1
            elif ftype == "xss":
                idx = _counters.get(field, 0) % len(self._XSS_PAYLOADS)
                result[field] = self._XSS_PAYLOADS[idx]
                _counters[field] = idx + 1
            elif ftype == "empty":
                result[field] = ""
            elif ftype == "long":
                result[field] = "A" * 10000
            else:
                result[field] = fuzz_fields[field]  # unchanged
        return result

    def _send_fuzzed(self, i: int, fuzz_fields: Dict[str, str],
                     fuzz_types: Dict[str, str],
                     _counters: Dict[str, int]) -> Dict:
        """Deep-copy payload, override fuzz fields, temporarily patch
        self.test.payload, call _send_one, then restore."""
        import copy
        original_payload = self.test.payload
        try:
            patched = copy.deepcopy(original_payload) if isinstance(original_payload, dict) else {}
            overrides = self._fuzz_payload(fuzz_fields, fuzz_types, _counters)
            patched.update(overrides)
            self.test.payload = patched
            return self._send_one(i)
        finally:
            self.test.payload = original_payload

    def run_fuzz(self, fuzz_fields: Dict[str, str] = None,
                 fuzz_types: Dict[str, str] = None,
                 max_requests: int = 100,
                 concurrency: int = 1,
                 delay: float = 0.05):
        """Fuzz the endpoint by overriding payload fields with generated values.
        fuzz_fields: {field_name: original_value} — fields to fuzz.
        fuzz_types:  {field_name: fuzz_type} — type of fuzz per field."""
        self._reset_metrics()
        self.update_stats(self._snapshot())
        fuzz_fields = fuzz_fields or {}
        fuzz_types = fuzz_types or {}
        _counters: Dict[str, int] = {}  # for cycling sql/xss sequences
        _counters_lock = threading.Lock()

        self.log(f"[fuzz] Starting: fields={list(fuzz_types.keys())} "
                 f"max_requests={max_requests} concurrency={concurrency}")

        if concurrency > 1:
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = []
                for i in range(1, max_requests + 1):
                    if self.stop_flag.get("stop"):
                        break
                    with _counters_lock:
                        # Snapshot counters for this submission
                        snap_counters = dict(_counters)
                    futures.append(executor.submit(
                        self._send_fuzzed, i, fuzz_fields, fuzz_types, snap_counters))
                    if delay > 0:
                        time.sleep(delay)
                for f in as_completed(futures):
                    if self.stop_flag.get("stop"):
                        break
        else:
            for i in range(1, max_requests + 1):
                if self.stop_flag.get("stop"):
                    break
                self._send_fuzzed(i, fuzz_fields, fuzz_types, _counters)
                if delay > 0:
                    time.sleep(delay)

        self.log(f"[fuzz] Finished. {self.metrics.results}")
        return self.metrics.results

    # -------------------------------------------------------------------------
    # BENCHMARK mode: warmup + percentile report
    # -------------------------------------------------------------------------
    def run_benchmark(self, n_samples: int = 100, warmup: int = 10):
        """Sequential benchmark: warmup requests (stats discarded), then
        n_samples requests with full percentile reporting at the end."""
        self._reset_metrics()
        self.update_stats(self._snapshot())

        self.log(f"[benchmark] Warming up ({warmup} requests, stats discarded) ...")
        for i in range(1, warmup + 1):
            if self.stop_flag.get("stop"):
                break
            self._send_one(i)

        # Reset after warmup
        self._reset_metrics()
        self.log(f"[benchmark] Warmup done. Running {n_samples} samples ...")

        for i in range(1, n_samples + 1):
            if self.stop_flag.get("stop"):
                break
            self._send_one(i)

        # Compute final percentiles
        srt = sorted(self.metrics.all_latencies)
        p = self._percentile
        self.log(
            f"[benchmark] Results ({len(srt)} samples): "
            f"p50={round(p(srt,50))}ms "
            f"p75={round(p(srt,75))}ms "
            f"p90={round(p(srt,90))}ms "
            f"p95={round(p(srt,95))}ms "
            f"p99={round(p(srt,99))}ms "
            f"p999={round(p(srt,99.9))}ms"
        )
        self.update_stats(self._snapshot())
        self.log(f"[benchmark] Finished. {self.metrics.results}")
        return self.metrics.results

    # -------------------------------------------------------------------------
    # WEBSOCKET mode: connect + send messages on shared connections
    # -------------------------------------------------------------------------
    def send_ws_once(self, max_body: int = 262144) -> Dict:
        """Interactive WS: connect, send one message, receive response, close."""
        url, headers, _ = self._build_request()
        start = time.time()
        try:
            ws = self.ws_transport.connect(url, headers, timeout=10)
        except Exception as e:
            return {"ok": False, "error": str(e), "target": url,
                    "time_ms": round((time.time() - start) * 1000)}

        msg = self._substitute(self.test.ws_message)
        msg_type = getattr(self.test, "ws_message_type", "text")
        try:
            self.ws_transport.send_message(ws, msg, msg_type)
            self.metrics.record_ws_message_sent()
        except Exception as e:
            self.ws_transport.close(ws)
            return {"ok": False, "error": str(e), "target": url,
                    "time_ms": round((time.time() - start) * 1000), "phase": "send"}

        recv_start = time.time()
        try:
            result = self.ws_transport.receive_message(ws, timeout=10)
            recv_elapsed = round((time.time() - recv_start) * 1000)
        except Exception as e:
            self.ws_transport.close(ws)
            return {"ok": False, "error": str(e), "target": url,
                    "time_ms": round((time.time() - start) * 1000), "phase": "receive"}

        self.ws_transport.close(ws)
        if result.get("data") is not None:
            self.metrics.record_ws_message_received()

        elapsed_ms = round((time.time() - start) * 1000)
        body = result.get("data") or ""
        parsed = None
        if result.get("type") == "text" and body:
            try:
                parsed = json.loads(body) if isinstance(body, str) else json.loads(body.decode())
            except Exception:
                parsed = None
        elif result.get("type") == "binary":
            body = result.get("data", "")

        response = {
            "ok": True,
            "status": "connected" if result.get("data") is not None else "timeout",
            "time_ms": elapsed_ms,
            "recv_ms": recv_elapsed,
            "content_type": "application/json" if parsed else ("application/octet-stream" if result.get("type") == "binary" else "text/plain"),
            "body": body,
            "json": parsed,
            "target": url,
            "target_type": "websocket",
            "ws_message_type": msg_type,
            "ws_sent": msg[:max_body] if msg else "",
            "ws_received_type": result.get("type"),
            "ws_raw_bytes": result.get("raw_bytes"),
        }
        response["assertions"] = evaluate_assertions(getattr(self.test, "assertions", None), response)
        response["passed"] = all(a["ok"] for a in response["assertions"]) if response["assertions"] else None
        return response

    def _send_ws_message(self, i: int, ws, timeout: int = 10) -> Dict:
        """Send one message on an open WS connection and record the response."""
        url, _, _ = self._build_request()
        msg = self._substitute(self.test.ws_message)
        msg_type = getattr(self.test, "ws_message_type", "text")

        start = time.time()
        try:
            self.ws_transport.send_message(ws, msg, msg_type)
            with self._lock:
                self.metrics.record_ws_message_sent()
        except Exception as e:
            with self._lock:
                self.metrics.record_ws_disconnect()
                self.metrics.record_error()
                snapshot = self._snapshot()
            self.update_stats(snapshot)
            return {"attempt": i, "url": url, "error": str(e), "phase": "send", "success": False}

        recv_start = time.time()
        try:
            result = self.ws_transport.receive_message(ws, timeout=timeout)
            elapsed = time.time() - start
            recv_elapsed = time.time() - recv_start
        except Exception as e:
            with self._lock:
                self.metrics.record_ws_disconnect()
                self.metrics.record_error()
                snapshot = self._snapshot()
            self.update_stats(snapshot)
            return {"attempt": i, "url": url, "error": str(e), "phase": "receive", "success": False}

        with self._lock:
            self.metrics.record_response(200, elapsed * 1000.0, False)
            if result.get("data") is not None:
                self.metrics.record_ws_message_received()
            snapshot = self._snapshot()

        body = result.get("data") or ""
        response = {
            "attempt": i,
            "url": url,
            "time": round(elapsed, 3),
            "success": result.get("data") is not None,
            "body": body[:50000] if result.get("type") == "text" else "",
            "ws_received_type": result.get("type"),
            "target_type": "websocket",
        }
        self.update_stats(snapshot)
        self.emit_response(response)
        self.log(f"[{i}] WS {url} -> {result.get('type', 'error')} ({elapsed:.2f}s)")
        return response

    def run_websocket(self, concurrency: int = 1, delay: float = 0.1,
                      max_requests: int = 100, timeout: int = 10):
        """WebSocket load test: each worker opens a connection and sends N messages."""
        self._reset_metrics()
        self.update_stats(self._snapshot())
        url, headers, _ = self._build_request()

        def _ws_worker(worker_id: int, n_messages: int):
            try:
                ws = self.ws_transport.connect(url, headers, timeout=timeout)
            except Exception as e:
                with self._lock:
                    self.metrics.record_ws_disconnect()
                self.log(f"[ws-worker-{worker_id}] Connection failed: {e}")
                return
            try:
                for i in range(n_messages):
                    if self.stop_flag.get("stop"):
                        break
                    self._send_ws_message(i + 1, ws, timeout=timeout)
                    if delay > 0:
                        time.sleep(delay)
            finally:
                self.ws_transport.close(ws)
                with self._lock:
                    self.metrics.record_ws_disconnect()

        messages_per_worker = max(1, max_requests // max(concurrency, 1))
        self.log(f"[websocket] Starting: concurrency={concurrency} messages_per_worker={messages_per_worker}")

        if concurrency > 1:
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = []
                for w in range(concurrency):
                    if self.stop_flag.get("stop"):
                        break
                    futures.append(executor.submit(_ws_worker, w + 1, messages_per_worker))
                for f in as_completed(futures):
                    if self.stop_flag.get("stop"):
                        break
        else:
            _ws_worker(1, max_requests)

        self.log(f"[websocket] Finished. {self.metrics.results}")
        return self.metrics.results

    def run_mode(self, mode: str, params: Dict = None):
        """Dispatch to the correct run method based on mode string.

        Modes: 'load' (default), 'ramp', 'spike', 'soak', 'rate_probe', 'capacity',
               'fuzz', 'benchmark'.
        params is a dict of mode-specific keyword arguments."""
        p = params or {}
        mode = (mode or "load").lower().strip()

        if mode == "load":
            return self.run()

        if mode == "ramp":
            return self.run_ramp(
                ramp_start=int(p.get("ramp_start", 1)),
                ramp_end=int(p.get("ramp_end", 16)),
                ramp_step_duration=float(p.get("ramp_step_duration", 10.0)),
                max_requests=int(p.get("max_requests", 500)),
                delay=float(p.get("delay", 0.05)),
            )

        if mode == "spike":
            return self.run_spike(
                baseline_workers=int(p.get("baseline_workers", 2)),
                peak_workers=int(p.get("peak_workers", 20)),
                baseline_requests=int(p.get("baseline_requests", 50)),
                peak_requests=int(p.get("peak_requests", 200)),
                recovery_requests=int(p.get("recovery_requests", 50)),
                delay=float(p.get("delay", 0.05)),
            )

        if mode == "soak":
            return self.run_soak(
                duration_s=float(p.get("duration_s", 300.0)),
                rps=float(p.get("rps", 5.0)),
                concurrency=int(p.get("concurrency", 1)),
            )

        if mode == "rate_probe":
            return self.run_rate_probe(
                start_rps=float(p.get("start_rps", 1.0)),
                step_rps=float(p.get("step_rps", 1.0)),
                step_requests=int(p.get("step_requests", 20)),
                max_rps=float(p.get("max_rps", 100.0)),
            )

        if mode == "capacity":
            return self.run_capacity(
                start_rps=float(p.get("start_rps", 5.0)),
                step_rps=float(p.get("step_rps", 5.0)),
                step_requests=int(p.get("step_requests", 30)),
                max_rps=float(p.get("max_rps", 200.0)),
                p95_limit_ms=float(p.get("p95_limit_ms", 500.0)),
                error_limit_pct=float(p.get("error_limit_pct", 1.0)),
                success_min_pct=float(p.get("success_min_pct", 99.0)),
            )

        if mode == "fuzz":
            return self.run_fuzz(
                fuzz_fields=p.get("fuzz_fields") or {},
                fuzz_types=p.get("fuzz_types") or {},
                max_requests=int(p.get("max_requests", 100)),
                concurrency=int(p.get("concurrency", 1)),
                delay=float(p.get("delay", 0.05)),
            )

        if mode == "benchmark":
            return self.run_benchmark(
                n_samples=int(p.get("n_samples", 100)),
                warmup=int(p.get("warmup", 10)),
            )

        if mode == "websocket":
            return self.run_websocket(
                concurrency=int(p.get("concurrency", 1)),
                delay=float(p.get("delay", 0.1)),
                max_requests=int(p.get("max_requests", 100)),
                timeout=int(p.get("timeout", 10)),
            )

        # Fallback: unknown mode -> standard load run
        self.log(f"[run_mode] Unknown mode '{mode}', falling back to 'load'")
        return self.run()
