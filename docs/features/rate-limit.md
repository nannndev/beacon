# Rate Limit Testing

One of Beacon's core strengths is its focus on rate limit and abuse testing.

## How Detection Works

Beacon considers a response rate limited if:

- Status code is `429`
- Response body contains words like "rate", "too many", "throttled", etc.

## Use Cases

- Test API rate limiting policies
- Validate abuse prevention mechanisms
- Measure how fast an endpoint returns 429
- Combine with extractors for authenticated abuse testing
