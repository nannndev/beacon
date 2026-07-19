# Security Policy

## Report vulnerabilities privately

Use [GitHub Security Advisories](https://github.com/nannndev/beacon/security/advisories/new)
to report a vulnerability in Beacon. Do not open a public issue with exploit
details, credentials, tokens, private endpoints, or proof-of-concept data.

Include:

- affected Beacon version or commit;
- affected component and platform;
- sanitized reproduction steps;
- impact and realistic attack conditions;
- a suggested mitigation when available.

Remove customer data and replace secrets with REDACTED values. We will
acknowledge, investigate, and coordinate a fix and disclosure on a best-effort
basis. We do not promise a fixed response deadline.

## Scope

This policy covers vulnerabilities in Beacon's source, desktop packaging,
backend, frontend, landing site, documentation tooling, and release workflow.

It does not authorize testing third-party APIs. Findings in a system tested with
Beacon must be reported to that system's owner under their policy. Requests to
attack systems without explicit authorization are out of scope.

## Safe handling

Give maintainers reasonable time to investigate before disclosure. Do not
exfiltrate data, disrupt services, persist access, or access more information
than required to demonstrate the Beacon vulnerability.
