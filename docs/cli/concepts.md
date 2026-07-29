# How Beacon CLI execution works

Beacon CLI is a headless entry point into the same execution engine used by Beacon Desktop. It is designed for automation, pull request checks, and terminal workflows.

## One project format

The CLI reads `beacon.yaml`, public environment files, and endpoint YAML directly. It does not import or translate the project into a second format. Changes made in Beacon Desktop are therefore the same changes reviewed and executed in CI.

## Ordered execution

Project and folder scopes execute sequentially in manifest order. This preserves workflows such as:

1. Send a login request.
2. Extract `body.access_token` into a variable.
3. Resolve the variable in a protected request.
4. Evaluate assertions against the protected response.

Iterations repeat the entire selected scope. Each process starts with a fresh in-memory variable map.

## Pass and fail rules

Before execution, `beacon run` performs the same semantic preflight exposed by `beacon validate`. Invalid project references, request configuration, templates, assertions, extractors, or required values stop the process before network traffic begins.

An execution passes only when:

- The request reaches the target.
- The response status is between 200 and 299.
- Every configured assertion passes.

An endpoint without assertions still requires a 2xx response.

## Private values

The Git-backed project stores private values separately under `.beacon/`, which is ignored by Git. On a developer machine, the CLI can read those local values. In CI, provide them through `BEACON_VAR_*`, `--env-file`, or `--env-var`.

Private variable names are validated before execution. JSON and JUnit reports contain extracted variable names but not their values, request headers, cookies, or response bodies.

## Local execution boundary

Every request runs on the device or CI worker that starts the CLI. Beacon Cloud and Beacon Desktop do not proxy the traffic. The runner uses that machine's network access, DNS, certificates, and firewall rules.

## Functional testing first

The first CLI contract focuses on deterministic functional execution. Load, ramp, spike, soak, and scenario concurrency remain desktop features until their headless configuration and CI safety contracts are finalized.
