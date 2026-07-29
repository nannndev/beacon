# Run your first project with Beacon CLI

This tutorial runs a Git-backed Beacon project from a terminal. The CLI uses the same endpoint definitions, assertions, extractors, and environments as the desktop app.

## Before you start

You need a project folder containing `beacon.yaml`. To create one:

1. Open a project in Beacon Desktop.
2. Open **Project Settings**.
3. Under **Git-backed project files**, select **Link folder**.
4. Choose an empty folder and let Beacon write the project files.

## Find the CLI

Open **Beacon CLI** from the desktop sidebar. The page shows the standalone executable installed with your current desktop version.

You can call that absolute path directly. To use `beacon` from any directory, add the executable's parent folder to your system `PATH`.

When developing Beacon from source, run the same CLI with Python:

```bash
cd backend
python -m app.cli --version
```

## Run the project

Move to the linked project folder and validate it first:

```bash
beacon validate .
```

Validation checks the project files, active environment, variables, assertions, extractors, and request configuration without sending network traffic. A valid project prints:

```text
No validation issues found.

VALID: 0 errors, 0 warnings
```

Then run the project:

```bash
beacon run .
```

Beacon executes endpoints in the order stored in `beacon.yaml`. Extracted response values are available to later requests in the same run.

A successful run ends with exit code `0`:

```text
PASS  POST    Login    200  94ms
PASS  GET     Profile  200  41ms

PASSED: 2 passed, 0 failed, 2 total in 139ms
```

HTTP errors, transport errors, and failed assertions produce exit code `1`.

## Choose an environment

Select an environment by name or stable ID:

```bash
beacon run . --env staging
```

The active environment stored in `beacon.yaml` is used when `--env` is omitted.

## Provide a private value

Git-backed projects do not commit private environment values. Supply them through the process environment:

```bash
BEACON_VAR_API_TOKEN=secret beacon run . --env CI
```

A project variable named `api-token` or `api_token` maps to `BEACON_VAR_API_TOKEN`.

You can also use a local env file:

```bash
beacon run . --env CI --env-file .env.ci
```

Do not commit the env file. Missing private values stop the run before the first request is sent.

## Run a smaller scope

Run one endpoint:

```bash
beacon run . --endpoint Login
```

Run a folder and its nested endpoints:

```bash
beacon run . --folder Auth
```

Names must be unique inside the project. Use a stable endpoint or folder ID when two resources share a name.

Discover the available names and IDs:

```bash
beacon list endpoints .
beacon list folders .
beacon list environments .
```

## Next steps

- Bootstrap CI from the repository root with `beacon ci init github .`.
- [Run Beacon in GitHub Actions](./github-actions.md)
- [CLI command reference](./reference.md)
- [How CLI execution works](./concepts.md)
