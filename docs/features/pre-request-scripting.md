# Pre-request Scripting

Every endpoint can run a small Python script right before the request is
dispatched — after templates are resolved and auth headers are merged, but
before the HTTP call goes out. This lets you compute signatures, inject
timestamps, generate nonces, or conditionally mutate any part of the request.

## The `beacon` object

Your script receives one global: `beacon`.

### `beacon.request`

Mutable access to the outgoing request:

| Attribute | Type | Description |
|---|---|---|
| `beacon.request.url` | `str` | Fully resolved URL (templates + base URL already applied) |
| `beacon.request.method` | `str` | HTTP method (GET, POST, PUT, etc.) |
| `beacon.request.headers` | dict-like | Request headers with `.add()`, `.remove()`, and dict access |
| `beacon.request.body` | `dict` / `any` | Parsed request payload |

```python
# Add a computed header
beacon.request.headers["X-Signature"] = signature

# Add multiple headers at once
beacon.request.headers.add({"X-Request-Id": req_id, "X-Timestamp": ts})

# Remove a header
beacon.request.headers.remove("X-Obsolete")

# Append a query parameter
beacon.request.url = beacon.request.url + "&limit=100"

# Inject a field into the JSON body
beacon.request.body["injected_at"] = "2026-01-01T00:00:00Z"
```

### `beacon.environment`

Read and write environment variables. Changes persist for the rest of the
session — later requests, chained scenarios, and extractors all see the
updated value.

| Method | Description |
|---|---|
| `beacon.environment.get("key")` | Returns the value as a string, or `None` |
| `beacon.environment.set("key", value)` | Stores a value (converted to `str`) |

```python
# Save a generated value for later
import uuid
beacon.environment.set("request_id", str(uuid.uuid4()))

# Read an existing variable
base = beacon.environment.get("base_url")
```

## Allowed modules

The sandbox imports these standard-library modules automatically:

| Module | Example usage |
|---|---|
| `json` | `json.dumps(pm.request.body)` |
| `hashlib` | `hashlib.sha256(body.encode()).hexdigest()` |
| `hmac` | `hmac.new(key, msg, hashlib.sha256).hexdigest()` |
| `time` | `str(time.time())` |
| `uuid` | `str(uuid.uuid4())` |
| `datetime` | `datetime.datetime.utcnow().isoformat()` |
| `base64` | `base64.b64encode(data).decode()` |
| `urllib.parse` | `urllib.parse.urlencode({"q": "test"})` |
| `re` | `re.search(r"\d+", body).group()` |
| `math` | `math.ceil(value)` |
| `random` | `random.randint(1000, 9999)` |

## Built-in safe functions

`abs`, `all`, `any`, `bool`, `dict`, `float`, `int`, `len`, `list`, `map`,
`max`, `min`, `print`, `range`, `round`, `set`, `sorted`, `str`, `sum`,
`tuple`, `zip`, and others.

## Snippet buttons

The editor has three quick-insert buttons above the text area:

- **Timestamp** — saves `time.time()` to a variable
- **HMAC-SHA256** — computes a signature from the body and adds it as a header
- **Random ID** — generates a UUID and saves it to a variable

## Error handling

Script errors never stop the request. If your script raises an exception:

- The error is logged to the run log
- The request is dispatched with its **original, unmodified** values
- You can fix the script and send again

A 5-second timeout prevents infinite loops.

## Full example

```python
import hashlib
import hmac
import json
import time
import uuid

# --- Timestamp header ---
beacon.request.headers["X-Request-Time"] = str(int(time.time()))

# --- Idempotency key (saved for the next call too) ---
key = str(uuid.uuid4())
beacon.request.headers["Idempotency-Key"] = key
beacon.environment.set("last_idempotency_key", key)

# --- HMAC-SHA256 signature ---
secret = beacon.environment.get("api_secret") or "default-secret"
body_str = json.dumps(beacon.request.body, separators=(",", ":"), sort_keys=True)
digest = hmac.new(
    secret.encode(), body_str.encode(), hashlib.sha256
).hexdigest()
beacon.request.headers["X-Signature"] = digest
```
