# Variables & Templating

Beacon supports powerful variable substitution using `{{variable}}` syntax.

## Built-in Generators

| Variable                    | Description                          | Example Output          |
|----------------------------|--------------------------------------|-------------------------|
| `{{random_email}}`         | Random email                         | user_7x3k2@gmail.com   |
| `{{uuid}}`                 | UUID v4                              | 550e8400-e29b-41d4-a716-446655440000 |
| `{{timestamp}}`            | Current Unix timestamp               | 1719840123             |
| `{{random_string:12}}`     | Random string of length              | aB3kP9mX2qL            |
| `{{random_number}}`        | Random number                        | 847291                 |
| `{{random_int:1:100}}`     | Random integer in range              | 47                     |

## Custom Variables

You can define variables in:

- Global Variables
- Environment Variables
- Per-request (temporarily)

Example:

```json
{
  "email": "{{random_email}}",
  "password": "Test123!",
  "device_id": "{{uuid}}"
}
```

## Chaining with Extractors

After a successful login, extract the token:

**Extractor:**
```json
{
  "access_token": "body.access_token"
}
```

Then use it in next requests:
```json
{
  "Authorization": "Bearer {{access_token}}"
}
```

This allows full auth flow testing.

Next: [Desktop App](/desktop)
