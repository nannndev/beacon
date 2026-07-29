"""Response assertion evaluation, independent from HTTP execution."""


def dig(data, path):
    if data is None or not path:
        return None
    normalized = path[5:] if path.startswith("body.") else path
    current = data
    for key in normalized.split("."):
        if isinstance(current, dict) and key in current:
            current = current[key]
        elif isinstance(current, list) and key.lstrip("-").isdigit() and -len(current) <= int(key) < len(current):
            current = current[int(key)]
        else:
            return None
    return current


def compare(operator, actual, expected):
    try:
        if operator == "eq": return str(actual) == str(expected)
        if operator == "ne": return str(actual) != str(expected)
        if operator in ("lt", "gt", "lte", "gte"):
            left, right = float(actual), float(expected)
            return {"lt": left < right, "gt": left > right, "lte": left <= right, "gte": left >= right}[operator]
        if operator == "contains": return str(expected) in str(actual)
        if operator == "exists": return actual is not None
    except Exception:
        return False
    return False


def evaluate_assertions(assertions, result):
    output = []
    body = result.get("body") or ""
    json_body = result.get("json")
    headers = {str(key).lower(): value for key, value in (result.get("headers") or {}).items()}
    for assertion in assertions or []:
        assertion_type = assertion.get("type")
        operator = assertion.get("op", "eq")
        expected = assertion.get("value")
        actual = None
        if assertion_type == "status":
            actual = result.get("status"); ok = compare(operator, actual, expected)
        elif assertion_type == "time_ms":
            actual = result.get("time_ms"); ok = compare(operator, actual, expected)
        elif assertion_type == "body_contains":
            ok = str(expected) in body
        elif assertion_type == "header":
            actual = headers.get(str(assertion.get("name", "")).lower())
            ok = actual is not None if operator == "exists" else compare(operator, actual, expected)
        elif assertion_type == "jsonpath":
            actual = dig(json_body, assertion.get("path", ""))
            ok = actual is not None if operator == "exists" else compare(operator, actual, expected)
        else:
            ok = False
        subject = {
            "status": "status code", "time_ms": "response time (ms)",
            "body_contains": "response body", "header": f"header {assertion.get('name', '')}",
            "jsonpath": f"JSON path {assertion.get('path', '')}",
        }.get(assertion_type, str(assertion_type or "unknown assertion"))
        message = f"{subject} {operator} {expected!r}"
        if not ok: message += f"; received {actual!r}"
        output.append({
            "type": assertion_type, "op": operator, "expected": expected,
            "actual": actual, "ok": bool(ok), "message": message,
        })
    return output
