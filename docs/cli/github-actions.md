# Run Beacon in GitHub Actions

This guide runs a Git-backed Beacon project for every push and pull request. A request or assertion failure blocks the workflow with a non-zero exit code.

## Store the project in Git

Commit the public Beacon files:

```text
api-tests/
├── beacon.yaml
├── endpoints/
└── environments/
```

Do not commit `api-tests/.beacon/`. Beacon adds it to `.gitignore` because it contains local private values.

## Add repository secrets

In the GitHub repository, open **Settings**, **Secrets and variables**, then **Actions**. Add each private value required by the selected Beacon environment.

For example, add a secret named `API_TOKEN` for the project variable `api_token`.

## Generate the workflow

From anywhere inside the repository, run:

```bash
beacon ci init github ./api-tests
```

Beacon finds the repository root and creates `.github/workflows/beacon.yml`. The generated workflow:

- Pins the Beacon CLI version currently installed on your machine.
- Validates the project before sending network traffic.
- Runs the active environment and fails the check on a request or assertion failure.
- Uploads JSON and JUnit reports even when the run fails.
- Adds a result summary and failure annotations directly to the GitHub Actions run.
- References private variables through GitHub Actions secrets without copying their values.

The command prints every required GitHub secret name after creating the file. Preview the YAML without writing anything:

```bash
beacon ci init github ./api-tests --dry-run
```

Choose a different environment or CLI version explicitly:

```bash
beacon ci init github ./api-tests --env CI --cli-version 0.4.8
```

Beacon will not overwrite an existing workflow. Review the dry-run output, then use `--force` only when you intend to replace `.github/workflows/beacon.yml`.

## Understand the generated workflow

The generated file is equivalent to:

```yaml
name: Beacon API tests

on:
  push:
  pull_request:

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Beacon CLI
        run: |
          curl -fsSL \
            https://github.com/nannndev/beacon/releases/latest/download/beacon-linux-x64 \
            -o beacon
          chmod +x beacon
          sudo mv beacon /usr/local/bin/beacon

      - name: Run Beacon project
        env:
          BEACON_VAR_API_TOKEN: ${{ secrets.API_TOKEN }}
        run: |
          beacon validate ./api-tests --env CI --strict
          beacon run ./api-tests \
            --env CI \
            --bail \
            --quiet \
            --github \
            --report-junit api-tests/reports/beacon.xml \
            --report-json api-tests/reports/beacon.json

      - name: Upload Beacon reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: beacon-reports
          path: api-tests/reports/
```

The generator pins a versioned release URL by default. Pass `--cli-version latest` only when you intentionally want every CI run to download the newest release.

`beacon run` validates the selected project automatically before sending traffic. The explicit strict validation above makes ambiguous resource names fail and surfaces preflight diagnostics before test output.

`--github` writes a Markdown result to GitHub's step summary and emits one annotation for each failed endpoint execution. These messages use status codes and assertion types only. Beacon intentionally excludes assertion expected/actual values, transport exception details, rendered URLs, and response data because they may contain secrets.

## Understand the result

Beacon returns:

- `0` when every selected request and assertion passes.
- `1` when an HTTP request, transport operation, or assertion fails.
- `2` when the project, environment, scope, or CLI arguments are invalid.
- `130` when the process is interrupted.

Open the finished workflow run to see the Beacon summary without downloading an artifact. The JSON and JUnit files remain available for deeper investigation and external reporting tools.

`--bail` stops after the first failed execution. Remove it when you want a complete failure report for the entire project.

## Test the workflow locally

Run the same command from the repository root before pushing:

```bash
BEACON_VAR_API_TOKEN=secret \
  beacon run ./api-tests --env CI --bail
```

The desktop app is not required during the run. Network access, certificates, DNS, and private values come from the machine executing the CLI.
