# Data-driven Runs (CSV/JSON)

Generators such as <code v-pre>{{random_email}}</code> are fine for smoke tests, but many APIs only accept real records: existing user accounts, valid product IDs, coupon codes. Attach a CSV or JSON file to a run and Beacon feeds its rows to your requests as variables.

## Attach test data

1. In the execution panel, click **Test data** and pick a `.csv` or `.json` file (up to 10 MB / 100,000 rows).
2. Beacon shows the file name, row and column count. Hover it to see the column names.
3. Choose **In order** (rows are used one after another and wrap around) or **Random**.
4. Use the columns anywhere a variable works: URL, headers, body, auth, proxy, and pre-request scripts.

```csv
username,password,store_id
alice@example.com,s3cret-1,17
bob@example.com,s3cret-2,42
```

<div v-pre>

```json
{ "email": "{{username}}", "password": "{{password}}" }
```

</div>

JSON files are an array of objects (or `{"rows": [...]}`); nested values are passed as JSON text.

## How rows are used

| Run | Row per | Example |
| --- | --- | --- |
| Load, Ramp, Spike, Soak, Rate Probe, Capacity, Fuzz, Benchmark | request | 500 requests over 100 rows use each row 5 times. |
| Scenario | virtual-user journey | Each journey logs in with one row and keeps using it for every later step. |
| CLI (`beacon run --data users.csv`) | pass over the selected endpoints | One pass per row unless `--iterations` is given. |

A row's values apply to that request or journey only. They override environment variables with the same name for that request, but they never change the saved environment, and scenario runs with test data always use isolated per-user variables.

## Privacy

Test data stays on your device. It is kept in memory for the current session and is not saved into the project, its YAML files, or Git. Run history and CLI reports record only the row count and row numbers, never the values, since test data often contains credentials.
