# Contributing to Beacon

Thanks for helping Beacon make API testing clearer. Contributions can be code,
documentation, design, testing, bug reports, or security research.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Choose a contribution path

- **Code:** fix a focused issue or discuss a larger feature before implementation.
- **Documentation:** correct an unclear page, example, setup step, or workflow.
- **Design:** explain the user problem and include a flow, screenshot, or mockup.
- **Testing:** report the build, platform, test area, exact steps, and sanitized result.
- **Bug reports:** use the bug form and provide the smallest reproducible case.
- **Security:** follow [SECURITY.md](SECURITY.md) and report privately.

Small corrections can go directly to a pull request. Open an issue before major
behavior, architecture, dependency, or interface changes.

## Safety and secrets

Beacon is intended only for systems you own or are explicitly authorized to test.
Do not use project channels to coordinate unauthorized testing.

Never commit or attach:

- bearer tokens, JWTs, API keys, cookies, or credentials;
- operational config/tests.json files;
- private endpoint URLs or customer data;
- unsanitized logs, screenshots, exports, or response bodies.

Use placeholders such as example.com and REDACTED. Vulnerabilities in Beacon must
be reported privately through GitHub Security Advisories, not a public issue.

## Repository architecture

The current product is FastAPI plus React/Vite/Tauri. A legacy Flask dashboard
coexists with it.

Testing-engine behavior exists in both:

- core/tester.py
- backend/app/core/tester.py

Changes to shared runner behavior must be applied to both files. Preserve the
FastAPI implementation's extractor support when keeping them synchronized.
Route layers are different and should not be copied between backends.

## Local setup

Install JavaScript dependencies from the repository root:

    corepack enable
    pnpm install
    pnpm --dir frontend install
    pnpm --dir landing install

Run the current stack:

    pnpm dev

Run individual surfaces when needed:

    cd backend
    pip install -r requirements.txt
    python -m uvicorn app.main:app --reload --port 8000

    cd frontend
    pnpm build

    cd landing
    pnpm test
    pnpm build

    cd ..
    pnpm docs:build
    pnpm test:community

For legacy Flask work:

    pip install -r requirements.txt
    python app.py

## Make a focused change

1. Fork the repository and branch from the latest main.
2. Keep unrelated formatting and refactors out of the change.
3. Add or update focused tests for behavior changes.
4. Update documentation when setup, UI, behavior, or contracts change.
5. Run the checks for every surface you touched.
6. Re-read the diff for secrets and private target data.

Use clear commits that describe one coherent change. Maintainers may squash a
pull request when merging.

## Open a pull request

Describe:

- the problem and why it matters;
- the chosen solution and important tradeoffs;
- exact verification commands and results;
- screenshots for visual changes;
- related issues and follow-up work that is intentionally out of scope.

Review feedback is part of collaboration. Keep discussion technical, specific,
and respectful. A maintainer may ask to narrow a pull request so it remains safe
to review and release.

## Need help?

Use the repository issue chooser for bugs, documentation, testing, and proposals.
Read the [development guide](docs/development.md) for the project structure.
