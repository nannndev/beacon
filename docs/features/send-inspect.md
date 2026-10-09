# Send & Response Inspector

In addition to load testing, Beacon supports firing **a single request** and inspecting the full response — similar to Postman or curl, but integrated with your variables, extractors, and assertions.

## The Send Button

- Located in the endpoint editor (next to Save).
- Sends the current request definition **once**, including edits you have not saved yet (they are not persisted until you click Save).
- Shortcuts: `Ctrl/Cmd + Enter` sends, `Ctrl/Cmd + S` saves.
- Honors the endpoint's:
  - `payload_type` (json / form / multipart / raw)
  - templating (`{{variables}}` and generators)
  - headers + cookies
  - extractors (on 2xx)
  - assertions

## Request Settings

The **Request settings** panel in the endpoint editor controls how the request travels. They apply to Send, load runs, scenarios, the CLI, and MCP alike.

| Setting | Default | Notes |
| --- | --- | --- |
| Timeout (seconds) | 10 s per run request, 30 s for Send | Raise it for slow reports or uploads so they are not counted as errors. |
| Follow redirects | On | Turn off to assert on the `3xx` response itself. |
| Verify TLS certificates | On | Turn off only for test servers you trust, such as staging with a self-signed certificate. |
| Proxy | None | Routes HTTP and HTTPS through e.g. Charles or Burp. Supports `{{variables}}`, so keep proxy credentials in an environment variable rather than in shared project files. |

Only settings you change are saved, so endpoints that keep the defaults have the same project file as before. Pasting a cURL command with `--max-time`, `-k`/`--insecure`, or `-x`/`--proxy` fills these settings in, and the generated cURL snippet includes them.

## Response Inspector

After a send (or while sending), the **Response** panel appears with tabs:

- **Body**
  - Pretty-printed JSON (with tree view)
  - Indented XML / HTML
  - Raw text fallback
  - Toggle between pretty and raw
- **Headers** — all response headers
- **Extracted** — variables that were refreshed by extractors on this response
- **Assertions** — pass/fail results for any assertions defined on the endpoint

### Useful Details Shown

- Status code (color-coded: 2xx green, 4xx amber, 5xx red, etc.)
- `time_ms`
- `size_bytes` (and `truncated` flag if the body was capped)
- `content_type`

## Click-to-Extract (Power Feature)

When viewing a JSON body and you are editing a saved endpoint:

- Click on any field in the pretty JSON tree.
- Choose **"Save as variable"** (or similar action).
- Beacon computes the dot-path (e.g. `body.data.user.id`) and offers to create an extractor.

This is the fastest way to wire up token chaining or data extraction.

## Retries on Send

The single-send flow supports optional `retries` and `retry_delay` (configurable in the UI near the Send button or via MCP).

## MCP Tool: `send_request`

```text
send_request(name_or_id, retries?, retry_delay?, max_body_chars?)
```

Returns the full `SendResponse` shape including `json`, `extracted`, `assertions`, and `passed`.
The MCP response body defaults to 20,000 characters to protect the agent's
context window and can be adjusted up to 100,000 with `max_body_chars`.

This is extremely useful from AI agents:
- "Send the Login request so the token is fresh"
- "Inspect what the /users/me response actually looks like"
- Prime state before running a scenario

## Relationship to Other Features

- **Extractors** run exactly like they do in load runs.
- **Assertions** are evaluated and shown.
- Results feed into **Scenarios** (each step is a send + inspect under the hood).
- The same engine code path is used (`send_once`).

## When to Use Send vs Run

- Use **Send** when you want to see the response, debug, or set up state (extractors).
- Use **Run** (or Run Folder) when you want statistics, concurrency, rate-limit behavior, or many repetitions.

See also:
- [Assertions](./assertions.md)
- [Scenarios](./scenarios.md)
- [Variables](./variables.md)
