# Beacon CLI reference

## Synopsis

```text
beacon [--version] COMMAND [OPTIONS]
```

`PROJECT` is a folder containing `beacon.yaml` or the path to `beacon.yaml` itself. It defaults to the current directory.

## Commands

### `beacon validate [PROJECT]`

Load and validate a project without sending requests. Validation covers managed YAML references, stable IDs, ambiguous names, selected-environment base URLs, request methods and body types, variables, dynamic helpers, assertions, extractors, and saved run configuration.

Use the same environment inputs accepted by `run`:

```bash
beacon validate . --env CI --env-file .env.ci
```

Options:

| Option | Meaning |
| --- | --- |
| `--env NAME_OR_ID` | Validate against one environment. |
| `--env-file PATH` | Load local variable overrides. |
| `--env-var KEY=VALUE` | Override one variable; repeat as needed. |
| `--strict` | Treat warnings, such as ambiguous names, as invalid. |
| `--json` | Print structured diagnostics for automation. |

The command returns `0` when valid and `2` when errors—or warnings in strict mode—are present.

### `beacon list RESOURCE [PROJECT]`

Discover resource names and stable IDs without opening Beacon Desktop. `RESOURCE` is one of:

- `endpoints`: method, name, parent folder, and endpoint ID.
- `folders`: full folder path, nested endpoint count, and folder ID.
- `environments`: name, base URL, active state, and environment ID.

```bash
beacon list endpoints .
beacon list folders . --json
beacon list environments /path/to/project
```

Add `--json` for structured output.

### `beacon ci init github [PROJECT]`

Generate `.github/workflows/beacon.yml` for a Git-backed Beacon project. The project must live inside a Git repository. Beacon detects its repository-relative path, pins the selected CLI version, adds validation and execution steps, uploads JSON and JUnit reports, and maps private variable names to GitHub Actions secrets without reading their values into the workflow.

```bash
beacon ci init github ./api-tests
beacon ci init github ./api-tests --env CI --dry-run
```

Options:

| Option | Meaning |
| --- | --- |
| `--env NAME_OR_ID` | Generate for one environment; defaults to the active environment. |
| `--cli-version VERSION` | Pin a semantic Beacon release version, or explicitly use `latest`. |
| `--dry-run` | Print YAML without writing a workflow file. |
| `--force` | Replace a different existing `.github/workflows/beacon.yml`. |
| `--repo-root PATH` | Use an explicit Git repository root. |

Running the command again is safe when the generated content is unchanged. A different existing workflow is preserved unless `--force` is supplied.

### `beacon run [PROJECT]`

Validate, then execute the selected project scope. No request is sent when preflight validation fails.

## Scope options

### `--endpoint NAME_OR_ID`

Run one endpoint. Repeat the option to run multiple endpoints in the supplied order.

```bash
beacon run . --endpoint Login --endpoint Profile
```

### `--folder NAME_OR_ID`

Run every endpoint nested below one folder in manifest order.

```bash
beacon run . --folder Smoke
```

`--endpoint` and `--folder` cannot be combined. Without either option, Beacon runs the complete project.

## Environment options

### `--env NAME_OR_ID`

Select an environment. Beacon otherwise uses the project's active environment, then the first environment when no active environment is stored.

### `--env-file PATH`

Read local `KEY=VALUE` entries. Blank lines and lines starting with `#` are ignored. An optional `export` prefix and quoted values are supported.

### `--env-var KEY=VALUE`

Override a variable. Repeat the option to override multiple values.

Variable precedence, from lowest to highest:

1. Saved environment values.
2. `--env-file` values.
3. `BEACON_VAR_*` process environment variables.
4. `--env-var` values.

## Execution options

### `--iterations N`

Repeat the selected scope. Default: `1`. Full project and folder runs remain sequential so extractors can feed later requests.

### `--retries N`

Retry a transport failure or non-2xx HTTP response. Default: `0`.

### `--retry-delay MS`

Wait between retries in milliseconds. Default: `0`.

### `--bail`

Stop after the first failed execution.

## Report options

### `--report-json PATH`

Write a UTF-8 JSON document using `beacon.cli.report` version `1`. Reports contain execution summaries, assertion outcomes, status codes, timings, and extracted variable names. They do not contain request headers or extracted secret values.

### `--report-junit PATH`

Write JUnit XML. Each endpoint iteration becomes one test case. This format is accepted by common CI reporting systems.

## Output options

### `--quiet`

Suppress per-request output and print the final result.

### `--no-color`

Disable ANSI colors. Setting the standard `NO_COLOR` environment variable has the same effect.

### `--github`

Publish GitHub Actions-native feedback. Beacon appends a Markdown result to the file identified by `GITHUB_STEP_SUMMARY` and emits an `error` workflow command for every failed endpoint execution.

```bash
beacon run . --env CI --bail --quiet --github
```

The flag must run inside GitHub Actions or another environment that provides `GITHUB_STEP_SUMMARY`. If it is missing, Beacon exits with code `2` before sending any request. GitHub mode suppresses verbose per-request output; its summary and annotations exclude assertion values, response content, rendered URLs, and raw transport exceptions.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Every selected request and assertion passed. |
| `1` | At least one HTTP, transport, or assertion failure occurred. |
| `2` | The project, selected scope, environment, secret values, or arguments are invalid. |
| `130` | The user interrupted the run. |

## Version

```bash
beacon --version
```
