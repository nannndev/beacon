# Live Monitoring

Beacon provides real-time monitoring while running requests.

## Features

- Live attempts, success, rate limited, and error counts
- Per-response status and timing
- Automatic rate limit detection (HTTP 429 or text matching)
- Response body viewer with syntax highlighting

## How it Works

When you run an endpoint (or a folder), results are streamed live to the monitoring panel.

You can filter by status and view individual response bodies.

Completed load tests can be opened from **View in History**. For durable
metrics, retention, pinning, export, and two-run comparison, see
[Run History](./run-history.md).
