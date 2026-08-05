"""Serializable execution models shared by REST, MCP, persistence, and tests."""
from __future__ import annotations

import threading
import uuid
from typing import Any, Dict, List, Optional


class EndpointTest:
    def __init__(self, test_id: str, name: str, url: str, method: str = "POST",
                 headers: Optional[Dict] = None, payload: Any = None, payload_type: str = "json",
                 extractors: Optional[Dict] = None, run_config: Optional[Dict] = None,
                 assertions: Optional[List] = None, target_type: str = "api",
                 auth: Optional[Dict] = None, mock_response: Optional[Dict] = None):
        self.id = test_id or str(uuid.uuid4())
        self.name = name
        self.url = url
        self.method = method.upper()
        self.headers = headers or {}
        self.payload = {} if payload is None else payload
        self.payload_type = payload_type
        self.extractors = extractors or {}
        self.run_config = run_config or None
        self.assertions = assertions or []
        normalized_target = str(target_type or "api").lower()
        self.target_type = normalized_target if normalized_target in {"api", "web"} else "api"
        # Structured auth spec. None means "not configured" — those endpoints
        # carry any Authorization in `headers`, exactly as before this existed.
        self.auth = auth or None
        self.mock_response = mock_response or None
        # Auth inherited from the enclosing folders/project, outermost first.
        # Populated when the endpoint is flattened out of the project tree.
        self.inherited_auth: List[Dict] = []

    def to_dict(self):
        data = {
            "id": self.id, "name": self.name, "url": self.url, "method": self.method,
            "headers": self.headers, "payload": self.payload, "payload_type": self.payload_type,
            "extractors": self.extractors, "run_config": self.run_config,
            "assertions": self.assertions, "target_type": self.target_type,
        }
        # Keep the persisted contract unchanged for endpoints without auth, so
        # existing projects and their YAML files round-trip byte-identically.
        if self.auth:
            data["auth"] = self.auth
        if self.mock_response:
            data["mock_response"] = self.mock_response
        return data

    @staticmethod
    def from_dict(data):
        return EndpointTest(
            data.get("id"), data["name"], data["url"], data.get("method", "POST"),
            data.get("headers", {}), data.get("payload", {}), data.get("payload_type", "json"),
            data.get("extractors", {}), data.get("run_config"), data.get("assertions", []),
            data.get("target_type", "api"), data.get("auth"), data.get("mock_response"),
        )


class TestConfig:
    __test__ = False

    def __init__(self, base_url: str = "", variables: Optional[Dict] = None,
                 tests: Optional[List[EndpointTest]] = None):
        self.base_url = base_url
        self.variables = variables or {}
        self.tests = tests or []
        # Extractors write tokens into `variables` from worker threads while
        # templating reads it to build concurrent requests. Without a shared
        # guard, adding a key mid-resolve raises "dictionary changed size
        # during iteration" and the request is silently lost. The lock lives on
        # the config because every APITester sharing this config must share it.
        self.variables_lock = threading.RLock()

    def snapshot_variables(self) -> Dict:
        """A stable copy safe to read while other threads extract into it."""
        with self.variables_lock:
            return dict(self.variables)

    def to_dict(self):
        return {
            "base_url": self.base_url,
            "variables": self.snapshot_variables(),
            "tests": [test.to_dict() for test in self.tests],
        }

    @staticmethod
    def from_dict(data):
        tests = [EndpointTest.from_dict(test) for test in data.get("tests", [])]
        return TestConfig(data.get("base_url", ""), data.get("variables", {}), tests)
