# Variables & Templating

Beacon supports powerful variable substitution using `{{variable}}` syntax.

## Built-in Generators

| Variable                    | Description                          | Example Output          |
|----------------------------|--------------------------------------|-------------------------|
| `{{random_email}}`         | Random email                         | user_7x3k2@gmail.com   |
| `{{uuid}}`                 | UUID v4                              | 550e8400-e29b-41d4-a716-446655440000 |
| `{{timestamp}}`            | Current Unix timestamp               | 1719840123             |
| <code v-pre>{{random_string:12}}</code>     | Random string of length              | aB3kP9mX2qL            |
| `{{random_number}}`        | Random number                        | 847291                 |
| <code v-pre>{{random_int:1:100}}</code>     | Random integer in range              | 47                     |
| `{{random_name}}`          | Random full name                     | Dewi Pratama           |
| `{{random_bool}}`          | `true` or `false`                    | true                   |
| `{{iso_date}}`             | Current UTC time, ISO 8601           | 2026-11-02T08:15:00Z   |
| <code v-pre>{{random_choice:a\|b\|c}}</code> | One of the listed options   | b                      |

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
