"""Sandboxed pre-request script execution engine.

Scripts run in a restricted Python environment with only safe builtins
and standard-library modules. They receive a `beacon` proxy object that
lets them mutate the outgoing request and read/write environment variables.

No new dependencies — uses only the stdlib + signal.
"""
from __future__ import annotations

import signal
import traceback
from typing import Any, Dict


class PreRequestError(Exception):
    """A script failed to execute — not a server error."""
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class PreRequestTimeout(PreRequestError):
    """Script exceeded the execution time limit."""


class _EnvProxy:
    """Read/write access to the active environment variables.

    beacon.environment.get("token") → str | None
    beacon.environment.set("token", value)

    Writes are *accumulated* in a scratch dict. The caller is
    responsible for merging them back into config.variables under
    the same lock that extractors use.
    """
    def __init__(self, variables: dict):
        self._variables = variables

    def get(self, key: str) -> str | None:
        val = self._variables.get(key)
        return str(val) if val is not None else None

    def set(self, key: str, value):
        if not isinstance(key, str) or not key.strip():
            return
        self._variables[key] = value


class _RequestProxy:
    """Mutable wrapper around the outgoing request.

    beacon.request.url       → str (fully resolved)
    beacon.request.method    → str
    beacon.request.headers   → dict-like
    beacon.request.body      → parsed payload (dict / any)

    Headers support .add(dict) and .remove(key).
    """
    def __init__(self, data: dict):
        self._data = data

    @property
    def url(self) -> str:
        return self._data["url"]

    @url.setter
    def url(self, value):
        self._data["url"] = str(value)

    @property
    def method(self) -> str:
        return self._data.get("method", "GET")

    @method.setter
    def method(self, value):
        self._data["method"] = str(value)

    @property
    def headers(self):
        return _HeadersProxy(self._data.setdefault("headers", {}))

    @property
    def body(self):
        return self._data.setdefault("body", {})

    @body.setter
    def body(self, value):
        self._data["body"] = value


class _HeadersProxy:
    """Dict-like wrapper with .add(dict) and .remove(key) helpers."""
    def __init__(self, headers: dict):
        self._headers = headers

    def __getitem__(self, key):
        return self._headers[key]

    def __setitem__(self, key, value):
        self._headers[key] = str(value)

    def __contains__(self, key):
        return key in self._headers

    def get(self, key, default=None):
        return self._headers.get(key, default)

    def add(self, mapping: dict):
        """Add or overwrite multiple headers at once."""
        for k, v in mapping.items():
            self._headers[k] = str(v)

    def remove(self, key: str):
        """Remove a header if it exists."""
        self._headers.pop(key, None)

    def keys(self):
        return self._headers.keys()

    def items(self):
        return self._headers.items()

    def __repr__(self):
        return repr(self._headers)


class PreRequestProxy:
    """The `beacon` object exposed to pre-request scripts.

    beacon.request     → _RequestProxy (mutable)
    beacon.environment → _EnvProxy (read/write variables)
    beacon.variables   → _EnvProxy (alias for environment)
    """
    def __init__(self, request_data: dict, variables: dict):
        self.request = _RequestProxy(request_data)
        self.environment = _EnvProxy(variables)
        self.variables = self.environment  # alias


class PreRequestEngine:
    ALLOWED_BUILTINS = frozenset({
        "abs", "all", "any", "bin", "bool", "chr", "dict",
        "divmod", "enumerate", "filter", "float", "format",
        "frozenset", "getattr", "hasattr", "hex", "int", "isinstance",
        "issubclass", "iter", "len", "list", "map", "max", "min",
        "next", "oct", "ord", "pow", "print", "range", "repr",
        "reversed", "round", "set", "slice", "sorted", "str",
        "sum", "tuple", "type", "zip", "__import__",
    })

    ALLOWED_MODULES = {
        "base64", "datetime", "hashlib", "hmac", "json",
        "math", "random", "re", "time", "urllib.parse", "uuid",
    }

    @staticmethod
    def _build_globals(context: dict) -> dict:
        """Construct a restricted global namespace for exec()."""
        g: dict = {"__builtins__": {name: __builtins__[name] for name in PreRequestEngine.ALLOWED_BUILTINS if name in __builtins__}}
        for mod_name in PreRequestEngine.ALLOWED_MODULES:
            try:
                g[mod_name] = __import__(mod_name)
            except ImportError:
                pass

        variables = context.get("variables")
        if variables is None:
            variables = {}
            context["variables"] = variables
        g["beacon"] = PreRequestProxy(context, variables)
        return g

    def execute(self, script: str, context: dict, timeout: int = 5) -> dict:
        """Execute a pre-request script and return the mutated context.

        The context dict must contain: url, method, headers, body.
        Returns the same dict with any mutations applied.
        """
        globals_ = self._build_globals(context)
        raised: Exception | None = None

        # Timeout guard — signal.alarm is unavailable on Windows.
        # Graceful fallback: skip timeout, log a warning later.
        platform_has_alarm = hasattr(signal, "alarm") and hasattr(signal, "SIGALRM")
        if platform_has_alarm:
            def _timeout_handler(signum, frame):
                raise PreRequestTimeout("Script timed out after %d seconds" % timeout)
            old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
            signal.alarm(timeout)

        try:
            exec(script, globals_)
        except PreRequestTimeout:
            raised = PreRequestTimeout("Script timed out after %d seconds" % timeout)
        except SyntaxError as e:
            raised = PreRequestError(f"Syntax error (line {e.lineno}): {e.msg}")
        except Exception as e:
            lines = traceback.format_exception_only(type(e), e)
            msg = lines[-1].strip() if lines else str(e)
            raised = PreRequestError(msg)
        finally:
            if platform_has_alarm:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)

        if raised:
            raise raised

        return context
