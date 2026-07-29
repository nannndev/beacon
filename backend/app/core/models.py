"""Serializable execution models shared by REST, MCP, persistence, and tests."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional


class EndpointTest:
    def __init__(self, test_id: str, name: str, url: str, method: str = "POST",
                 headers: Optional[Dict] = None, payload: Any = None, payload_type: str = "json",
                 extractors: Optional[Dict] = None, run_config: Optional[Dict] = None,
                 assertions: Optional[List] = None, target_type: str = "api"):
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

    def to_dict(self):
        return {
            "id": self.id, "name": self.name, "url": self.url, "method": self.method,
            "headers": self.headers, "payload": self.payload, "payload_type": self.payload_type,
            "extractors": self.extractors, "run_config": self.run_config,
            "assertions": self.assertions, "target_type": self.target_type,
        }

    @staticmethod
    def from_dict(data):
        return EndpointTest(
            data.get("id"), data["name"], data["url"], data.get("method", "POST"),
            data.get("headers", {}), data.get("payload", {}), data.get("payload_type", "json"),
            data.get("extractors", {}), data.get("run_config"), data.get("assertions", []),
            data.get("target_type", "api"),
        )


class TestConfig:
    __test__ = False

    def __init__(self, base_url: str = "", variables: Optional[Dict] = None,
                 tests: Optional[List[EndpointTest]] = None):
        self.base_url = base_url
        self.variables = variables or {}
        self.tests = tests or []

    def to_dict(self):
        return {
            "base_url": self.base_url,
            "variables": self.variables,
            "tests": [test.to_dict() for test in self.tests],
        }

    @staticmethod
    def from_dict(data):
        tests = [EndpointTest.from_dict(test) for test in data.get("tests", [])]
        return TestConfig(data.get("base_url", ""), data.get("variables", {}), tests)
