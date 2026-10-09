"""Sandboxed pre-request script execution engine.

Scripts run in a restricted Python environment with only safe builtins
and standard-library modules. They receive a `beacon` proxy object that
lets them mutate the outgoing request and read/write environment variables.

This is defense in depth for scripts shared through projects, not an
OS-level isolation boundary. No new dependencies — stdlib only.
"""
from __future__ import annotations

import ast
import importlib
import sys
import time
import traceback
import types
from types import SimpleNamespace
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


class _ScriptTimeout(BaseException):
    """Raised from the trace hook. A BaseException so a script's own
    `except Exception:` cannot swallow the deadline."""


def _safe_module(module, depth: int = 0) -> SimpleNamespace:
    """Expose a module's public, non-module attributes only.

    Handing scripts the real module objects leaks everything those modules
    import (`uuid.os`, `json.codecs.sys`, ...), which is a direct path to
    `os.system`. Submodules are re-wrapped so `urllib.parse` still works.
    """
    attrs = {}
    for name in dir(module):
        if name.startswith("_"):
            continue
        value = getattr(module, name)
        if isinstance(value, types.ModuleType):
            if depth == 0 and value.__name__ == f"{module.__name__}.{name}":
                attrs[name] = _safe_module(value, depth + 1)
            continue
        attrs[name] = value
    return SimpleNamespace(**attrs)


class PreRequestEngine:
    ALLOWED_BUILTINS = frozenset({
        "abs", "all", "any", "bin", "bool", "chr", "dict",
        "divmod", "enumerate", "filter", "float",
        "frozenset", "hasattr", "hex", "int", "isinstance",
        "iter", "len", "list", "map", "max", "min",
        "next", "oct", "ord", "pow", "print", "range", "repr",
        "reversed", "round", "set", "slice", "sorted", "str",
        "sum", "tuple", "zip",
        "Exception", "ValueError", "KeyError", "TypeError",
    })

    ALLOWED_MODULES = {
        "base64", "datetime", "hashlib", "hmac", "json",
        "math", "random", "re", "time", "urllib.parse", "uuid",
    }

    # `str.format` reads attributes from inside a string, out of reach of the
    # AST check below ("{0.__class__}"), so the method names are blocked too.
    _BLOCKED_ATTRIBUTES = {"format", "format_map", "mro"}

    @classmethod
    def _validate(cls, script: str) -> None:
        """Reject the attribute and name access every known escape relies on
        (`().__class__.__base__.__subclasses__()`, `fn.__globals__`, ...)."""
        tree = ast.parse(script, mode="exec")
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and (
                node.attr.startswith("_") or node.attr in cls._BLOCKED_ATTRIBUTES
            ):
                raise PreRequestError(f"Access to '.{node.attr}' is not allowed (line {node.lineno})")
            if isinstance(node, ast.Name) and node.id.startswith("__"):
                raise PreRequestError(f"Name '{node.id}' is not allowed (line {node.lineno})")
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [node.module or ""] if isinstance(node, ast.ImportFrom) else [a.name for a in node.names]
                for name in names:
                    if name not in cls.ALLOWED_MODULES and name != "urllib":
                        raise PreRequestError(f"Module '{name}' is not available (line {node.lineno})")

    @classmethod
    def _modules(cls) -> Dict[str, SimpleNamespace]:
        modules: Dict[str, SimpleNamespace] = {}
        for mod_name in cls.ALLOWED_MODULES:
            top = mod_name.split(".")[0]
            try:
                modules[top] = _safe_module(importlib.import_module(top))
            except ImportError:
                pass
        if "urllib" in modules:
            # Only urllib.parse is allowed; drop request/error/response.
            modules["urllib"] = SimpleNamespace(parse=_safe_module(importlib.import_module("urllib.parse")))
        return modules

    @classmethod
    def _build_globals(cls, context: dict) -> dict:
        """Construct a restricted global namespace for exec()."""
        import builtins

        modules = cls._modules()

        def _import(name, globals=None, locals=None, fromlist=(), level=0):
            top = name.split(".")[0]
            if level or top not in modules or (name not in cls.ALLOWED_MODULES and name != "urllib"):
                raise ImportError(f"Module '{name}' is not available in pre-request scripts")
            if fromlist and "." in name:
                return getattr(modules[top], name.split(".", 1)[1])
            return modules[top]

        safe_builtins = {name: getattr(builtins, name) for name in cls.ALLOWED_BUILTINS}
        safe_builtins["__import__"] = _import
        g: dict = {"__builtins__": safe_builtins, **modules}

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

        The deadline is enforced with a per-thread trace hook rather than
        SIGALRM: runs execute scripts on worker threads, where installing a
        signal handler raises, and SIGALRM does not exist on Windows.
        """
        try:
            self._validate(script)
        except SyntaxError as e:
            raise PreRequestError(f"Syntax error (line {e.lineno}): {e.msg}")
        globals_ = self._build_globals(context)
        deadline = time.monotonic() + timeout

        def _tracer(frame, event, arg):
            if time.monotonic() > deadline:
                raise _ScriptTimeout()
            return _tracer

        previous = sys.gettrace()
        sys.settrace(_tracer)
        try:
            exec(compile(script, "<pre-request>", "exec"), globals_)
        except _ScriptTimeout:
            raise PreRequestTimeout("Script timed out after %d seconds" % timeout)
        except PreRequestError:
            raise
        except Exception as e:
            lines = traceback.format_exception_only(type(e), e)
            msg = lines[-1].strip() if lines else str(e)
            raise PreRequestError(msg)
        finally:
            sys.settrace(previous)

        return context
