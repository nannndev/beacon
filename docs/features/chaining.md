# Chained Requests (Extractors)

One of the most powerful features in Beacon is the ability to chain requests using **extractors**.

## What are Extractors?

After a successful response (2xx), you can extract values and store them as variables for later use.

Example:

**Login request response:**
```json
{
  "access_token": "eyJhbGciOi..."
}
```

**Extractor:**
```json
{
  "access_token": "body.access_token"
}
```

**Next request:**
```json
{
  "Authorization": "Bearer {{access_token}}"
}
```

## Supported Extractor Paths

- `body.field.nested`
- `headers.Set-Cookie` (basic)

This enables full authentication flows and dependent request testing.
