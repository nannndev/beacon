# Contributor Portal and Community Standards Design

**Date:** 2026-07-19
**Status:** Approved direction; awaiting written-spec review
**Scope:** GitHub community health files, contributor documentation, and the standalone landing site

## Goal

Make it obvious how someone can contribute to Beacon, regardless of whether they want to write code, improve documentation, propose design work, test releases, report a bug, or disclose a security vulnerability. GitHub remains the source of truth for contribution rules; the landing site becomes the welcoming, visual entry point.

## Design Direction

Use the approved **Contributor Portal** direction:

- A concise open-source hero with a primary **Start contributing** action and secondary repository action.
- Six equal contribution-track cards: Code, Documentation, Design, Testing, Bug reports, and Security.
- A three-step path from choosing work to opening a pull request.
- A compact rules section that links to the canonical GitHub documents rather than duplicating every rule.
- An automatically populated GitHub contributor wall with graceful loading and failure states.
- Beacon's existing dark, technical, cyan-accented visual language, typography, spacing, theme behavior, and responsive conventions.

The page should feel like part of Beacon rather than a generic documentation template or a social leaderboard.

## Information Architecture

### Landing entry points

The existing landing page will expose Contributors in three places:

1. Desktop and mobile navigation.
2. The open-source/support section, where contributing becomes a first-class action alongside financial support.
3. The footer.

All entry points lead to `/contributors/`. The contributor page provides a visible route back to the Beacon landing page, documentation, and GitHub repository.

### Contributor page sections

The page order is:

1. **Hero** - explains that contribution is broader than code and offers clear GitHub actions.
2. **Choose your track** - six cards explaining the expected first action for each contribution type.
3. **How contribution works** - three numbered steps: choose or discuss work, make and verify the change, open a focused pull request.
4. **Rules that protect the project** - concise requirements covering authorization, secrets, duplicated engine files, focused changes, tests, and respectful collaboration.
5. **GitHub contributors** - automatically loaded contributor profiles.
6. **Final call to action** - links to open issues, the complete contribution guide, and GitHub Discussions or the repository when Discussions is unavailable.

### Track destinations

- **Code:** repository issues filtered to open work and the root contribution guide.
- **Documentation:** the documentation issue form.
- **Design:** the feature/design proposal issue form, with screenshots or rationale requested.
- **Testing:** the testing/QA issue form, including environment and reproducible observations.
- **Bug reports:** the structured bug report form.
- **Security:** the repository's private Security Advisory flow. It must never direct vulnerability details to a public issue.

## URL and Build Architecture

The landing project currently has one Vite entry and no client router. The contributor portal will use Vite's multi-page application support rather than add a routing dependency:

- Existing landing entry: `/index.html`.
- Contributor entry: `/contributors/index.html`.
- Shared React bootstrap modules render the appropriate page.
- Vite Rollup input configuration explicitly includes both HTML entries.

This produces a real `dist/contributors/index.html`, so `/contributors/` works as a direct link on ordinary static hosting without relying on a rewrite rule. Internal links use the trailing-slash canonical URL. The contributor HTML entry receives its own page title, description, and social metadata.

## Landing Components

### Page composition

`ContributorPage.tsx` owns the page-level composition and content arrays. Repeated or behavior-heavy pieces are separated:

- `ContributorWall.tsx` owns asynchronous contributor loading and its UI states.
- `githubContributors.ts` owns API types, validation, filtering, sorting, and session caching.
- Existing `BrandMark`, `ThemeToggle`, and `NetworkBackground` components are reused.

The existing landing header is tightly coupled to section observation and mobile navigation, so the contributor page will use a smaller dedicated header rather than refactor the entire landing page. Its visual dimensions and controls remain consistent with the main site.

### Responsive behavior

- Wide desktop: six track cards in a three-column grid; contributor cards in a dense responsive wall.
- Tablet: two-column track grid and two-column process/rules layouts.
- Mobile: single-column tracks, vertically stacked actions, readable rule cards, and contributor cards that never require horizontal scrolling.
- Navigation remains keyboard usable and touch targets are at least 44 px where practical.

### Accessibility

- One `h1`, ordered section headings, landmarks, and descriptive link labels.
- Decorative icons and backgrounds are hidden from assistive technology.
- Contributor avatars use the GitHub login as meaningful alternative text.
- Loading uses visible skeletons with a polite status message; failures use text and a working repository link.
- Focus styling must remain visible in light and dark themes.
- Motion honors `prefers-reduced-motion` through existing CSS conventions.

## GitHub Contributor Data

### Source

The browser fetches the public endpoint:

`GET https://api.github.com/repos/nannndev/beacon/contributors?per_page=100`

No GitHub token, secret, or private endpoint is shipped to the browser.

### Normalization

Only valid user records are rendered. The normalizer:

- Requires a login, profile URL, avatar URL, and positive contribution count.
- Excludes bot accounts by GitHub type and conventional `[bot]` login suffix.
- Preserves GitHub's contribution ordering, with a stable contribution-count fallback sort.
- Caps the rendered wall to a sensible first page so layout and network work stay bounded.

The displayed label is **GitHub contributors**, because the API measures repository contributions and is not a complete measure of issue triage, design discussion, or community support.

### Cache and failure behavior

- Successful normalized data is stored in `sessionStorage` with a timestamp.
- Cached data younger than 30 minutes is reused to avoid repeated unauthenticated API calls during navigation.
- Invalid cache entries are ignored without breaking the page.
- Requests use an abort signal so an unmounted page cannot update state.
- HTTP errors, malformed responses, offline state, and API rate limiting all resolve to the same calm fallback: explain that profiles could not be loaded and offer a direct GitHub contributors/repository link.
- An empty valid response renders an invitation to become the next contributor rather than an empty grid.

## Canonical GitHub Community Files

### `CONTRIBUTING.md`

The root guide contains:

- Supported contribution types and how to choose one.
- A short code of conduct commitment.
- Issue-first guidance for major changes and a fast path for small fixes.
- Repository architecture, including the current FastAPI/React direction and legacy Flask implementation.
- Setup and verification commands for landing, frontend, backend, docs, and desktop-relevant work.
- Branch, commit, pull request, documentation, and screenshot expectations.
- The duplicated testing-engine warning: engine changes must be applied to both `core/tester.py` and `backend/app/core/tester.py`, while preserving the FastAPI extractor behavior.
- Secret-handling rules for `config/tests.json`, bearer tokens, JWTs, endpoint URLs, screenshots, logs, and exported results.
- Links to the Code of Conduct, Security Policy, and issue forms. A public contributor-portal URL is included only after the landing domain is configured; repository documentation must not publish a localhost URL.

### `CODE_OF_CONDUCT.md`

Adopt a clear community code covering expected respectful behavior, unacceptable conduct, reporting, enforcement, and scope. Conduct reports use a private maintainer channel rather than public issues. Where a permanent private contact is not configured, the document points to GitHub's private repository contact/security mechanism and explicitly avoids promising an unconfigured email address.

### `SECURITY.md`

The policy distinguishes vulnerabilities in Beacon from vulnerabilities in third-party targets tested with Beacon. It requires:

- Authorized testing only.
- Private reporting through GitHub Security Advisories.
- No public proof-of-concept or credential disclosure before coordination.
- Reproduction details with sensitive values removed.
- Acknowledgement and remediation expectations phrased as best effort, without unsupported response-time guarantees.
- A clear statement that requests to attack systems without authorization are out of scope.

### Issue forms

Create YAML issue forms under `.github/ISSUE_TEMPLATE/`:

- `bug_report.yml` - version, platform, component, reproduction, expected/actual behavior, logs with a secrets warning, and authorization confirmation where target interaction is involved.
- `feature_request.yml` - problem, proposed outcome, alternatives, scope, and optional design references.
- `documentation.yml` - affected page, problem, suggested correction, and willingness to submit a PR.
- `testing_report.yml` - build/environment, test area, steps, result, and sanitized evidence.
- `config.yml` - disables blank issues and links to private security reporting, contribution rules, and community guidance.

Security vulnerabilities do not receive a public issue form.

### Pull request template

The PR template requests:

- Problem and solution summary.
- Change type.
- Verification commands and results.
- UI screenshots for visual changes.
- Checklist for focused scope, documentation, tests, secret removal, authorized testing, and duplicated engine synchronization when applicable.

The checklist should prompt good review behavior without claiming that every checkbox applies to every PR.

### Existing documentation

`docs/development.md` will replace its one-line contribution note with a concise link to `CONTRIBUTING.md`, the contributor portal, and the security policy. It remains a development overview rather than duplicating the complete guide.

## Baseline Landing Fix

The landing build on `origin/main` currently fails because `landing/src/components/ui/button.tsx` imports `@/lib/utils`, but `landing/src/lib/utils.ts` is absent. The implementation may add the standard local `cn` utility used by that component. This fix is intentionally small, does not alter button behavior, and must be verified before contributor-page work is considered responsible for any later build failure.

## Testing and Verification

### Automated

- Add focused tests for contributor normalization, bot filtering, malformed records, cache freshness, invalid cache fallback, and API failure handling.
- TypeScript compilation and Vite production build must emit both `dist/index.html` and `dist/contributors/index.html`.
- Validate GitHub YAML community files parse successfully.
- Confirm repository links are syntactically valid and use the canonical `nannndev/beacon` path.

### Manual and visual

- Verify `/` and `/contributors/` in light and dark themes.
- Verify direct navigation and cross-page links, including browser back/forward behavior.
- Inspect desktop, tablet, and mobile widths for overflow, card balance, text wrapping, and touch targets.
- Exercise contributor loading, cached loading, empty data, offline/error fallback, and long GitHub login names.
- Keyboard-test navigation order, focus visibility, and all calls to action.
- Confirm security links open the private advisory path rather than a public issue.

## Acceptance Criteria

- A first-time visitor can identify an appropriate contribution path and its first action without reading the full repository guide.
- Both the landing site and GitHub expose contribution rules.
- All six requested contribution types have a clear entry point.
- GitHub contributor profiles load automatically without embedding credentials and fail gracefully.
- Vulnerability reports are directed privately and authorized-testing boundaries are explicit.
- Direct `/contributors/` navigation works in the built static output.
- The landing build passes after the baseline utility fix.
- Existing landing content and navigation continue to work.

## Out of Scope

- Contributor authentication, profiles, badges, rankings, or a custom community database.
- GitHub OAuth or shipping a GitHub API token in the frontend.
- Automated contributor rewards or gamification.
- Creating or administering a Discord server.
- Changing Beacon's test engine, API contracts, or application dashboard.
- Publishing the landing site to a hosting provider as part of this feature.
