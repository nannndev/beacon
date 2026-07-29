"""Detection and normalization for portable API project formats.

Every importer returns the same Beacon project shape and a conversion report.
No persistence happens here, which makes preview and import use identical logic.
"""
from __future__ import annotations

import json
import re
import uuid
from collections import defaultdict
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..core.models import EndpointTest

try:
    import yaml
except ImportError:  # pragma: no cover - production requirements include PyYAML
    yaml = None


class ProjectImportError(ValueError):
    pass


METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}


def materialize_items(items: list[dict]) -> tuple[list[dict], list[dict]]:
    """Assign collision-free ids and validate normalized request nodes.

    Returns the persisted tree plus its flat endpoint compatibility view. Both
    REST and MCP imports must use this after `normalize_project`.
    """
    flattened: list[dict] = []

    def prepare(node: dict) -> dict:
        if node.get("type") == "folder":
            return {
                "id": str(uuid.uuid4()),
                "name": node.get("name") or "Folder",
                "type": "folder",
                "items": [prepare(child) for child in node.get("items", [])],
            }
        endpoint_id = str(uuid.uuid4())
        try:
            endpoint = EndpointTest.from_dict({**node, "id": endpoint_id})
        except Exception as error:
            raise ProjectImportError(
                f"Endpoint '{node.get('name', 'Unnamed')}' is invalid: {error}"
            ) from error
        serialized = endpoint.to_dict()
        flattened.append(serialized)
        return {"type": "request", **serialized}

    return [prepare(item) for item in items], flattened


def parse_source(data: Any) -> tuple[Any, str]:
    """Accept old direct JSON bodies and the new {content, filename} envelope."""
    if isinstance(data, dict) and isinstance(data.get("content"), str):
        raw = data["content"].strip()
        filename = str(data.get("filename") or "")
        if not raw:
            raise ProjectImportError("The selected file is empty.")
        try:
            return json.loads(raw), filename
        except json.JSONDecodeError as json_error:
            if yaml is None:
                raise ProjectImportError(f"Invalid JSON: {json_error.msg}") from json_error
            try:
                parsed = yaml.safe_load(raw)
            except Exception as yaml_error:
                raise ProjectImportError(f"Could not parse JSON or YAML: {yaml_error}") from yaml_error
            if not isinstance(parsed, (dict, list)):
                raise ProjectImportError("The file must contain a JSON/YAML object or collection.")
            return parsed, filename
    return data, ""


def normalize_project(data: Any) -> dict:
    source, filename = parse_source(data)
    if not isinstance(source, dict):
        raise ProjectImportError("Expected a project or API collection object at the top level.")

    fmt = detect_format(source)
    warnings: list[str] = []
    if fmt == "beacon":
        project = _beacon(source, warnings)
    elif fmt == "postman":
        project = _postman(source, warnings)
    elif fmt in {"openapi3", "swagger2"}:
        project = _openapi(source, warnings, swagger=fmt == "swagger2")
    elif fmt == "insomnia":
        project = _insomnia(source, warnings)
    elif fmt == "har":
        project = _har(source, warnings)
    elif fmt == "legacy":
        project = _legacy(source, warnings)
    else:  # pragma: no cover
        raise ProjectImportError("Unsupported import format.")

    items = project.get("items") or []
    endpoints, folders = _count_tree(items)
    if endpoints == 0:
        raise ProjectImportError(
            "No importable requests were found. Use a Beacon export, Postman collection, "
            "OpenAPI/Swagger document, Insomnia export, or HAR file."
        )
    project["name"] = str(project.get("name") or _stem(filename) or "Imported Project")
    project["environments"] = project.get("environments") or [_environment("Local")]
    return {
        "format": fmt,
        "format_label": {
            "beacon": "Beacon project", "postman": "Postman collection",
            "openapi3": "OpenAPI 3", "swagger2": "Swagger 2",
            "insomnia": "Insomnia export", "har": "HTTP Archive (HAR)",
            "legacy": "Beacon legacy config",
        }[fmt],
        "project": project,
        "summary": {
            "name": project["name"], "endpoints": endpoints, "folders": folders,
            "environments": len(project["environments"]), "warnings": len(warnings),
        },
        "warnings": _unique(warnings),
    }


def detect_format(data: dict) -> str:
    payload = data.get("project") if isinstance(data.get("project"), dict) else data
    if data.get("format") in {"security-tools.project", "beacon.project"}:
        return "beacon"
    if isinstance(payload, dict) and ("items" in payload or "environments" in payload) and "paths" not in payload:
        return "beacon"
    info = data.get("info") or {}
    if "item" in data and (isinstance(info, dict) or data.get("variable") is not None):
        return "postman"
    if str(data.get("openapi", "")).startswith("3") and isinstance(data.get("paths"), dict):
        return "openapi3"
    if str(data.get("swagger", "")).startswith("2") and isinstance(data.get("paths"), dict):
        return "swagger2"
    if data.get("_type") == "export" and isinstance(data.get("resources"), list):
        return "insomnia"
    if isinstance(data.get("log"), dict) and isinstance(data["log"].get("entries"), list):
        return "har"
    if "tests" in payload and ("base_url" in payload or "variables" in payload):
        return "legacy"
    raise ProjectImportError(
        "Format not recognized. Supported: Beacon, Postman v2, OpenAPI 3, Swagger 2, Insomnia, and HAR."
    )


def _beacon(data: dict, warnings: list[str]) -> dict:
    if data.get("format") in {"security-tools.project", "beacon.project"}:
        version = data.get("version")
        if version not in (None, 1):
            raise ProjectImportError(f"Beacon project version {version!r} is not supported.")
    payload = data.get("project") if isinstance(data.get("project"), dict) else data
    items = payload.get("items")
    if items is None and payload.get("tests"):
        items = [{"type": "request", **test} for test in payload["tests"] if isinstance(test, dict)]
    if not isinstance(items, list):
        raise ProjectImportError("Beacon project field 'items' must be an array.")
    return {
        "name": payload.get("name") or "Imported Beacon Project",
        "environments": _normalize_environments(payload.get("environments"), warnings),
        "items": [_normalize_beacon_node(item, warnings) for item in items if isinstance(item, dict)],
    }


def _normalize_beacon_node(node: dict, warnings: list[str]) -> dict:
    if node.get("type") == "folder" or isinstance(node.get("items"), list):
        return {"name": node.get("name") or "Folder", "type": "folder", "items": [
            _normalize_beacon_node(child, warnings) for child in node.get("items", []) if isinstance(child, dict)
        ]}
    return _request(
        node.get("name"), node.get("url"), node.get("method"), node.get("headers"),
        node.get("payload"), node.get("payload_type"), extractors=node.get("extractors"),
        assertions=node.get("assertions"), run_config=node.get("run_config"),
        target_type=node.get("target_type"),
    )


def _legacy(data: dict, warnings: list[str]) -> dict:
    payload = data.get("project") if isinstance(data.get("project"), dict) else data
    tests = payload.get("tests")
    if not isinstance(tests, list):
        raise ProjectImportError("Legacy config field 'tests' must be an array.")
    return {
        "name": payload.get("name") or "Imported Config",
        "environments": [_environment("Imported", payload.get("base_url", ""), payload.get("variables", {}))],
        "items": [_normalize_beacon_node(test, warnings) for test in tests if isinstance(test, dict)],
    }


def _postman(data: dict, warnings: list[str]) -> dict:
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    scripts = len(data.get("event") or [])

    def convert(node: dict, inherited_auth: Any = None) -> dict | None:
        nonlocal scripts
        scripts += len(node.get("event") or [])
        if isinstance(node.get("item"), list):
            children = [convert(child, node.get("auth", inherited_auth)) for child in node["item"] if isinstance(child, dict)]
            return {"name": node.get("name") or "Folder", "type": "folder", "items": [c for c in children if c]}
        req = node.get("request")
        if isinstance(req, str):
            return _request(node.get("name"), req, "GET")
        if not isinstance(req, dict):
            warnings.append(f"Skipped Postman item '{node.get('name', 'Unnamed')}' because it has no request.")
            return None
        url = req.get("url", "")
        if isinstance(url, dict):
            url = url.get("raw") or _postman_url(url)
        headers = _header_list(req.get("header"))
        _apply_postman_auth(headers, req.get("auth", inherited_auth), warnings)
        payload, payload_type = _postman_body(req.get("body"), warnings, node.get("name", "Request"))
        scripts += len(req.get("event") or [])
        return _request(node.get("name"), url, req.get("method"), headers, payload, payload_type)

    items = [convert(item, data.get("auth")) for item in data.get("item", []) if isinstance(item, dict)]
    if scripts:
        warnings.append(f"Ignored {scripts} Postman pre-request/test script block(s); Beacon does not execute collection scripts.")
    variables = {str(v.get("key")): v.get("value", "") for v in data.get("variable", []) if isinstance(v, dict) and v.get("key")}
    return {
        "name": info.get("name") or data.get("name") or "Imported Postman Collection",
        "environments": [_environment("Collection variables", variables=variables)],
        "items": [item for item in items if item],
    }


def _postman_url(url: dict) -> str:
    host = url.get("host") or []
    path = url.get("path") or []
    base = ".".join(host) if isinstance(host, list) else str(host)
    result = f"{url.get('protocol', 'https')}://{base}/{'/'.join(path) if isinstance(path, list) else path}"
    query = [(q.get("key", ""), q.get("value", "")) for q in url.get("query", []) if isinstance(q, dict) and not q.get("disabled")]
    return f"{result}?{urlencode(query, safe='{}')}" if query else result


def _postman_body(body: Any, warnings: list[str], name: str) -> tuple[Any, str]:
    if not isinstance(body, dict):
        return {}, "json"
    mode = body.get("mode")
    if mode == "raw":
        raw = str(body.get("raw") or "")
        try:
            return json.loads(raw), "json"
        except json.JSONDecodeError:
            return raw, "raw"
    if mode in {"urlencoded", "formdata"}:
        rows = body.get(mode) or []
        payload = {}
        for row in rows:
            if not isinstance(row, dict) or not row.get("key") or row.get("disabled"):
                continue
            if row.get("type") == "file":
                warnings.append(f"'{name}': imported file field '{row['key']}' without a local file value.")
                payload[row["key"]] = ""
            else:
                payload[row["key"]] = row.get("value", "")
        return payload, "multipart" if mode == "formdata" else "form"
    if mode == "graphql":
        graph = body.get("graphql") or {}
        variables = graph.get("variables") or {}
        if isinstance(variables, str):
            try: variables = json.loads(variables)
            except json.JSONDecodeError: variables = {}
        return {"query": graph.get("query", ""), "variables": variables}, "json"
    if mode == "file":
        warnings.append(f"'{name}': binary request body was omitted; select the file again on this device.")
        return {}, "multipart"
    return {}, "json"


def _apply_postman_auth(headers: dict, auth: Any, warnings: list[str]) -> None:
    if not isinstance(auth, dict) or auth.get("type") in (None, "noauth"):
        return
    kind = auth.get("type")
    values = {str(v.get("key")): v.get("value", "") for v in auth.get(kind, []) if isinstance(v, dict)}
    if kind == "bearer":
        headers.setdefault("Authorization", f"Bearer {values.get('token', '{{access_token}}')}")
    elif kind == "apikey":
        if values.get("in") == "header": headers.setdefault(str(values.get("key") or "X-API-Key"), values.get("value", ""))
        else: warnings.append("A Postman API key stored in query parameters needs manual review.")
    elif kind == "basic":
        headers.setdefault("Authorization", "Basic {{basic_auth}}")
        warnings.append("Basic auth credentials were replaced with {{basic_auth}} to avoid embedding secrets.")
    else:
        warnings.append(f"Postman auth type '{kind}' is not converted automatically.")


def _openapi(data: dict, warnings: list[str], swagger: bool) -> dict:
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    base_url = _swagger_base(data) if swagger else _openapi_server(data)
    by_tag: dict[str, list] = defaultdict(list)
    ungrouped = []
    schemes = (data.get("components") or {}).get("securitySchemes", {}) if not swagger else data.get("securityDefinitions", {})
    for path, path_item in data.get("paths", {}).items():
        if not isinstance(path_item, dict): continue
        for method, operation in path_item.items():
            if method.lower() not in METHODS or not isinstance(operation, dict): continue
            parameters = [p for p in (path_item.get("parameters", []) + operation.get("parameters", [])) if isinstance(p, dict)]
            url, headers = _openapi_parameters(path, parameters, data)
            payload, payload_type = _openapi_body(operation, parameters, data, swagger)
            _openapi_security(headers, operation.get("security", data.get("security")), schemes, warnings)
            request = _request(operation.get("summary") or operation.get("operationId") or f"{method.upper()} {path}", url, method, headers, payload, payload_type)
            tags = operation.get("tags") or []
            (by_tag[str(tags[0])] if tags else ungrouped).append(request)
    items = [{"name": tag, "type": "folder", "items": requests} for tag, requests in by_tag.items()] + ungrouped
    return {"name": info.get("title") or "Imported API", "environments": [_environment("Imported", base_url)], "items": items}


def _openapi_server(data: dict) -> str:
    servers = data.get("servers") or []
    if not servers or not isinstance(servers[0], dict): return ""
    url = str(servers[0].get("url") or "")
    for key, spec in (servers[0].get("variables") or {}).items():
        url = url.replace("{" + key + "}", str((spec or {}).get("default", "")))
    return url.rstrip("/")


def _swagger_base(data: dict) -> str:
    host = data.get("host", "")
    if not host: return str(data.get("basePath") or "")
    scheme = (data.get("schemes") or ["https"])[0]
    return f"{scheme}://{host}{data.get('basePath', '')}".rstrip("/")


def _openapi_parameters(path: str, parameters: list, root: dict) -> tuple[str, dict]:
    headers, query = {}, []
    url = re.sub(r"\{([^}]+)\}", r"{{\1}}", path)
    for param in parameters:
        param = _resolve_ref(param, root)
        name, location = param.get("name"), param.get("in")
        if not name or location == "body": continue
        value = _example(param.get("schema") or param, param.get("example"))
        token = _query_scalar(value) if value not in (None, "") else "{{" + str(name) + "}}"
        if location == "query": query.append((str(name), str(token)))
        elif location == "header": headers[str(name)] = token
    if query:
        url += ("&" if "?" in url else "?") + urlencode(query, safe="{}")
    return url, headers


def _openapi_body(operation: dict, parameters: list, root: dict, swagger: bool) -> tuple[Any, str]:
    if swagger:
        body = next((_resolve_ref(p, root) for p in parameters if p.get("in") == "body"), None)
        if body: return _example(body.get("schema", {}), body.get("x-example")), "json"
        form = [p for p in parameters if p.get("in") == "formData"]
        if form: return {p.get("name"): _example(p, None) for p in form if p.get("name")}, "multipart"
        return {}, "json"
    content = (operation.get("requestBody") or {}).get("content") or {}
    if not content: return {}, "json"
    mime, spec = next(iter(content.items()))
    spec = spec if isinstance(spec, dict) else {}
    payload = spec.get("example") if "example" in spec else _example(_resolve_ref(spec.get("schema", {}), root), None)
    if "multipart" in mime: return payload or {}, "multipart"
    if "x-www-form-urlencoded" in mime: return payload or {}, "form"
    if "json" not in mime: return payload if isinstance(payload, str) else json.dumps(payload or {}), "raw"
    return payload or {}, "json"


def _openapi_security(headers: dict, security: Any, schemes: dict, warnings: list[str]) -> None:
    if not security or not isinstance(security, list) or not security[0]: return
    name = next(iter(security[0]))
    scheme = schemes.get(name, {}) if isinstance(schemes, dict) else {}
    kind = scheme.get("type")
    if kind == "http" and scheme.get("scheme") == "bearer": headers.setdefault("Authorization", "Bearer {{access_token}}")
    elif kind == "apiKey" and scheme.get("in") == "header": headers.setdefault(scheme.get("name", "X-API-Key"), "{{api_key}}")
    elif kind in {"oauth2", "openIdConnect"}: headers.setdefault("Authorization", "Bearer {{access_token}}")
    else: warnings.append(f"Security scheme '{name}' needs manual configuration.")


def _insomnia(data: dict, warnings: list[str]) -> dict:
    resources = [r for r in data.get("resources", []) if isinstance(r, dict)]
    workspace = next((r for r in resources if r.get("_type") == "workspace"), {})
    groups = {r.get("_id"): r for r in resources if r.get("_type") == "request_group"}
    requests = [r for r in resources if r.get("_type") == "request"]
    children: dict[Any, list] = defaultdict(list)
    for req in requests:
        body = req.get("body") or {}
        mime, text = body.get("mimeType", ""), body.get("text", "")
        try: payload = json.loads(text) if "json" in mime and text else text
        except json.JSONDecodeError: payload = text
        payload_type = "json" if "json" in mime else ("form" if "form" in mime else "raw")
        url = req.get("url", "")
        params = [(p.get("name", ""), p.get("value", "")) for p in req.get("parameters", []) if isinstance(p, dict) and not p.get("disabled")]
        if params: url += ("&" if "?" in url else "?") + urlencode(params, safe="{}")
        children[req.get("parentId")].append(_request(req.get("name"), url, req.get("method"), _header_list(req.get("headers"), "name"), payload, payload_type))
    def folder(group: dict) -> dict:
        nested = [folder(g) for g in groups.values() if g.get("parentId") == group.get("_id")]
        return {"name": group.get("name") or "Folder", "type": "folder", "items": nested + children.get(group.get("_id"), [])}
    root_id = workspace.get("_id")
    items = [folder(g) for g in groups.values() if g.get("parentId") == root_id] + children.get(root_id, [])
    env = next((r for r in resources if r.get("_type") == "environment" and r.get("parentId") == root_id), {})
    return {"name": workspace.get("name") or "Imported Insomnia Workspace", "environments": [_environment("Imported", variables=env.get("data", {}))], "items": items}


def _har(data: dict, warnings: list[str]) -> dict:
    domains: dict[str, list] = defaultdict(list)
    for index, entry in enumerate(data["log"].get("entries", []), 1):
        req = entry.get("request") if isinstance(entry, dict) else None
        if not isinstance(req, dict): continue
        url = str(req.get("url") or "")
        host = urlsplit(url).netloc or "Requests"
        headers = {
            key: value for key, value in _header_list(req.get("headers"), "name").items()
            if key.lower() not in {"authorization", "cookie", "proxy-authorization"}
        }
        post = req.get("postData") or {}
        text = post.get("text", "")
        mime = post.get("mimeType", "")
        try: payload = json.loads(text) if "json" in mime and text else text
        except json.JSONDecodeError: payload = text
        domains[host].append(_request(f"{req.get('method', 'GET')} {urlsplit(url).path or '/'}", url, req.get("method"), headers, payload, "json" if "json" in mime else "raw"))
    warnings.append("HAR response bodies, cookies, and captured authorization values were not imported.")
    return {"name": "Imported HAR", "environments": [_environment("Captured")], "items": [{"name": host, "type": "folder", "items": items} for host, items in domains.items()]}


def _request(name: Any, url: Any, method: Any = "GET", headers: Any = None, payload: Any = None, payload_type: Any = "json", **extra) -> dict:
    if not isinstance(url, str) or not url.strip():
        raise ProjectImportError(f"Request '{name or 'Unnamed'}' is missing a URL.")
    return {
        "name": str(name or f"{str(method or 'GET').upper()} {url}"), "type": "request",
        "url": url, "method": str(method or "GET").upper(), "headers": headers if isinstance(headers, dict) else {},
        "payload": {} if payload is None else payload, "payload_type": payload_type or "json",
        "extractors": extra.get("extractors") if isinstance(extra.get("extractors"), dict) else {},
        "assertions": extra.get("assertions") if isinstance(extra.get("assertions"), list) else [],
        "run_config": extra.get("run_config") if isinstance(extra.get("run_config"), dict) else None,
        "target_type": extra.get("target_type") if extra.get("target_type") in {"api", "web"} else "api",
    }


def _environment(name: str, base_url: str = "", variables: Any = None) -> dict:
    return {"name": name, "base_url": str(base_url or ""), "variables": variables if isinstance(variables, dict) else {}}


def _normalize_environments(value: Any, warnings: list[str]) -> list:
    if value is None: return [_environment("Local")]
    if not isinstance(value, list): raise ProjectImportError("Project field 'environments' must be an array.")
    return [_environment(str(e.get("name") or "Imported"), e.get("base_url", ""), e.get("variables")) for e in value if isinstance(e, dict)]


def _header_list(rows: Any, key_name: str = "key") -> dict:
    return {str(row.get(key_name)): row.get("value", "") for row in rows or [] if isinstance(row, dict) and row.get(key_name) and not row.get("disabled")}


def _resolve_ref(schema: Any, root: dict) -> Any:
    if not isinstance(schema, dict) or "$ref" not in schema: return schema
    current: Any = root
    for part in str(schema["$ref"]).removeprefix("#/").split("/"):
        current = current.get(part, {}) if isinstance(current, dict) else {}
    return current


def _example(schema: Any, explicit: Any) -> Any:
    if explicit is not None: return explicit
    if not isinstance(schema, dict): return ""
    if "example" in schema: return schema["example"]
    if "default" in schema: return schema["default"]
    if "enum" in schema and schema["enum"]: return schema["enum"][0]
    kind = schema.get("type")
    if kind == "object" or "properties" in schema: return {key: _example(value, None) for key, value in schema.get("properties", {}).items()}
    if kind == "array": return [_example(schema.get("items", {}), None)]
    if kind in {"integer", "number"}: return 0
    if kind == "boolean": return False
    return ""


def _count_tree(items: list) -> tuple[int, int]:
    endpoints = folders = 0
    for item in items:
        if not isinstance(item, dict): continue
        if item.get("type") == "folder":
            folders += 1
            child_endpoints, child_folders = _count_tree(item.get("items") or [])
            endpoints += child_endpoints; folders += child_folders
        elif item.get("type") == "request": endpoints += 1
    return endpoints, folders


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _query_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _stem(filename: str) -> str:
    return re.sub(r"\.(json|ya?ml|har)$", "", filename, flags=re.I).strip()
