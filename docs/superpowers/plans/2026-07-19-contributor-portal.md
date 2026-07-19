# Contributor Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a static /contributors/ portal, automatic GitHub contributor wall, and complete GitHub contribution standards for Beacon.

**Architecture:** Keep GitHub documents as the canonical rules and make the landing project a visual entry point. Use Vite multi-page output for a real contributors/index.html, a tested pure TypeScript GitHub data layer, and a focused React page that reuses Beacon's existing brand primitives.

**Tech Stack:** React 18, TypeScript 5.5, Vite 5, Tailwind CSS 3, Vitest 2, GitHub public REST API, GitHub issue forms.

## Global Constraints

- Preserve Beacon's existing dark technical visual language, light theme, cyan accents, typography, and responsive conventions.
- Use /contributors/ as the canonical internal URL and emit dist/contributors/index.html.
- Do not add a client-side routing dependency.
- Never ship a GitHub token or another secret to the browser.
- The contributor wall must filter bots, cache valid results for 30 minutes in sessionStorage, abort on unmount, and fail gracefully.
- Cover Code, Documentation, Design, Testing, Bug reports, and Security as distinct contribution paths.
- Security disclosures must use the private GitHub Security Advisory route, never a public issue.
- State that Beacon is for authorized testing only and never accept credentials, JWTs, operational config, or sensitive target data in contributions.
- If testing-engine behavior changes in future contributions, both core/tester.py and backend/app/core/tester.py must stay synchronized while preserving FastAPI extractor behavior.
- Do not redesign the Beacon application dashboard or change backend/API contracts.
- Use pnpm and preserve both lockfiles.

---

## File Map

**Create**

- landing/src/lib/utils.ts - shared cn class-merging helper required by the existing button primitive.
- landing/src/lib/utils.test.ts - regression test for the missing baseline helper.
- landing/src/lib/githubContributors.ts - contributor types, normalization, cache, and fetch logic.
- landing/src/lib/githubContributors.test.ts - pure tests for contributor filtering, cache, and network behavior.
- landing/src/components/ContributorWall.tsx - asynchronous contributor-wall presentation.
- landing/src/pages/ContributorPage.tsx - approved portal page composition.
- landing/src/contributors.tsx - React bootstrap for the contributor entry.
- landing/contributors/index.html - standalone Vite HTML entry and contributor metadata.
- CONTRIBUTING.md - canonical contribution guide.
- CODE_OF_CONDUCT.md - project conduct policy.
- SECURITY.md - private vulnerability reporting and authorized-testing policy.
- .github/ISSUE_TEMPLATE/config.yml - issue chooser configuration.
- .github/ISSUE_TEMPLATE/bug_report.yml - structured bug report.
- .github/ISSUE_TEMPLATE/feature_request.yml - feature and design proposal.
- .github/ISSUE_TEMPLATE/documentation.yml - documentation report.
- .github/ISSUE_TEMPLATE/testing_report.yml - testing and QA report.
- .github/PULL_REQUEST_TEMPLATE.md - pull request checklist.
- scripts/validate-community-files.mjs - deterministic YAML and community-file validation.

**Modify**

- landing/package.json and landing/pnpm-lock.yaml - add Vitest and the test script.
- landing/vite.config.ts - register both Vite HTML inputs.
- landing/tailwind.config.js - scan the contributor HTML entry.
- landing/src/pages/LandingPage.tsx - add contributor navigation and calls to action.
- package.json and pnpm-lock.yaml - add YAML validation dependency and script.
- docs/development.md - link to the canonical contribution and security policies.

---

### Task 1: Restore the landing baseline and add the test harness

**Files:**

- Modify: .gitignore
- Create: landing/src/lib/utils.test.ts
- Create: landing/src/lib/utils.ts
- Modify: landing/package.json
- Modify: landing/pnpm-lock.yaml

**Interfaces:**

- Produces: cn(...inputs: ClassValue[]): string
- Produces: pnpm test as the landing unit-test command
- Consumed by: existing landing/src/components/ui/button.tsx

- [ ] **Step 1: Install the compatible test runner and register the test command**

Run:

~~~powershell
cd landing
pnpm add -D vitest@^2.1.8
~~~

Add this script beside build in landing/package.json:

~~~json
"test": "vitest run"
~~~

Expected: landing/package.json and landing/pnpm-lock.yaml change, with no production dependency added.

- [ ] **Step 2: Write the failing regression test**

Create landing/src/lib/utils.test.ts:

~~~ts
import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('combines conditional classes and resolves Tailwind conflicts', () => {
    expect(cn('rounded-md px-2', false && 'hidden', ['px-4', 'font-semibold'])).toBe(
      'rounded-md px-4 font-semibold',
    )
  })
})
~~~

- [ ] **Step 3: Run the focused test and confirm the baseline defect**

Run:

~~~powershell
pnpm test -- src/lib/utils.test.ts
~~~

Expected: FAIL because ./utils does not exist.

- [ ] **Step 4: Add the minimal class utility**

Create landing/src/lib/utils.ts:

~~~ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
~~~

- [ ] **Step 5: Verify the test and restore the production build**

Run:

~~~powershell
pnpm test -- src/lib/utils.test.ts
pnpm build
~~~

Expected: one test passes and Vite completes without the missing @/lib/utils error.

- [ ] **Step 6: Commit the baseline repair**

~~~powershell
git add .gitignore landing/package.json landing/pnpm-lock.yaml landing/src/lib/utils.ts landing/src/lib/utils.test.ts docs/superpowers/plans/2026-07-19-contributor-portal.md
git commit -m "fix: restore landing class utility"
~~~

---

### Task 2: Build the tested GitHub contributor data layer

**Files:**

- Create: landing/src/lib/githubContributors.test.ts
- Create: landing/src/lib/githubContributors.ts

**Interfaces:**

- Produces: Contributor with login, profileUrl, avatarUrl, and contributions.
- Produces: normalizeContributors(input: unknown, limit?: number): Contributor[]
- Produces: readContributorCache(storage: StorageReader, now?: number): Contributor[] | null
- Produces: writeContributorCache(storage: StorageWriter, contributors: Contributor[], now?: number): void
- Produces: fetchGitHubContributors(signal?: AbortSignal, fetcher?: typeof fetch): Promise<Contributor[]>
- Consumed by: ContributorWall.tsx in Task 3

- [ ] **Step 1: Write failing normalization and cache tests**

Create landing/src/lib/githubContributors.test.ts:

~~~ts
import { describe, expect, it, vi } from 'vitest'
import {
  CONTRIBUTOR_CACHE_KEY,
  CONTRIBUTOR_CACHE_TTL_MS,
  fetchGitHubContributors,
  normalizeContributors,
  readContributorCache,
  writeContributorCache,
  type Contributor,
} from './githubContributors'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    raw(key: string) {
      return values.get(key)
    },
  }
}

const ada: Contributor = {
  login: 'ada',
  profileUrl: 'https://github.com/ada',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  contributions: 12,
}

describe('normalizeContributors', () => {
  it('keeps valid users, removes bots and malformed records, and sorts by contribution count', () => {
    const result = normalizeContributors([
      {
        login: 'grace',
        html_url: 'https://github.com/grace',
        avatar_url: 'https://avatars.githubusercontent.com/u/2',
        contributions: 4,
        type: 'User',
      },
      {
        login: 'release[bot]',
        html_url: 'https://github.com/apps/release',
        avatar_url: 'https://avatars.githubusercontent.com/u/3',
        contributions: 99,
        type: 'Bot',
      },
      {
        login: 'ada',
        html_url: 'https://github.com/ada',
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
        contributions: 12,
        type: 'User',
      },
      { login: 'missing-urls', contributions: 3, type: 'User' },
    ])

    expect(result.map((item) => item.login)).toEqual(['ada', 'grace'])
  })

  it('returns an empty list for non-array API data', () => {
    expect(normalizeContributors({ message: 'rate limited' })).toEqual([])
  })
})

describe('contributor cache', () => {
  it('round-trips fresh data and expires it after thirty minutes', () => {
    const storage = memoryStorage()
    writeContributorCache(storage, [ada], 1_000)

    expect(readContributorCache(storage, 1_000 + CONTRIBUTOR_CACHE_TTL_MS - 1)).toEqual([ada])
    expect(readContributorCache(storage, 1_000 + CONTRIBUTOR_CACHE_TTL_MS)).toBeNull()
    expect(storage.raw(CONTRIBUTOR_CACHE_KEY)).toContain('"login":"ada"')
  })

  it('ignores invalid JSON and invalid cached contributor records', () => {
    const broken = { getItem: () => '{broken' }
    const malformed = {
      getItem: () => JSON.stringify({ savedAt: 10, contributors: [{ login: 'only-login' }] }),
    }

    expect(readContributorCache(broken, 20)).toBeNull()
    expect(readContributorCache(malformed, 20)).toBeNull()
  })

  it('keeps rendered data usable when browser storage rejects a write', () => {
    const unavailable = {
      setItem() {
        throw new Error('storage unavailable')
      },
    }
    expect(() => writeContributorCache(unavailable, [ada], 20)).not.toThrow()
  })
})

describe('fetchGitHubContributors', () => {
  it('requests the public repository endpoint and returns normalized users', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            login: 'ada',
            html_url: 'https://github.com/ada',
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
            contributions: 12,
            type: 'User',
          },
        ]),
        { status: 200 },
      ),
    )

    await expect(fetchGitHubContributors(undefined, fetcher)).resolves.toEqual([ada])
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/nannndev/beacon/contributors?per_page=100',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it('rejects failed GitHub responses', async () => {
    const fetcher = vi.fn(async () => new Response('rate limited', { status: 403 }))
    await expect(fetchGitHubContributors(undefined, fetcher)).rejects.toThrow(
      'GitHub contributors request failed with 403',
    )
  })
})
~~~

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run:

~~~powershell
cd landing
pnpm test -- src/lib/githubContributors.test.ts
~~~

Expected: FAIL because ./githubContributors does not exist.

- [ ] **Step 3: Implement normalization, cache, and fetch**

Create landing/src/lib/githubContributors.ts:

~~~ts
export interface Contributor {
  login: string
  profileUrl: string
  avatarUrl: string
  contributions: number
}

export interface StorageReader {
  getItem(key: string): string | null
}

export interface StorageWriter {
  setItem(key: string, value: string): void
}

interface ContributorCache {
  savedAt: number
  contributors: Contributor[]
}

export const CONTRIBUTOR_CACHE_KEY = 'beacon:github-contributors:v1'
export const CONTRIBUTOR_CACHE_TTL_MS = 30 * 60 * 1_000
const CONTRIBUTORS_URL =
  'https://api.github.com/repos/nannndev/beacon/contributors?per_page=100'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toContributor(value: unknown): Contributor | null {
  if (!isRecord(value)) return null
  if (value.type !== 'User') return null
  if (
    typeof value.login !== 'string' ||
    typeof value.html_url !== 'string' ||
    typeof value.avatar_url !== 'string' ||
    typeof value.contributions !== 'number' ||
    value.contributions <= 0 ||
    value.login.toLowerCase().endsWith('[bot]')
  ) {
    return null
  }

  return {
    login: value.login,
    profileUrl: value.html_url,
    avatarUrl: value.avatar_url,
    contributions: value.contributions,
  }
}

function isContributor(value: unknown): value is Contributor {
  if (!isRecord(value)) return false
  return (
    typeof value.login === 'string' &&
    typeof value.profileUrl === 'string' &&
    typeof value.avatarUrl === 'string' &&
    typeof value.contributions === 'number' &&
    value.contributions > 0
  )
}

export function normalizeContributors(input: unknown, limit = 100): Contributor[] {
  if (!Array.isArray(input)) return []

  return input
    .map(toContributor)
    .filter((item): item is Contributor => item !== null)
    .sort((left, right) => right.contributions - left.contributions)
    .slice(0, limit)
}

export function readContributorCache(
  storage: StorageReader,
  now = Date.now(),
): Contributor[] | null {
  try {
    const raw = storage.getItem(CONTRIBUTOR_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.contributors)) return null
    if (now - parsed.savedAt >= CONTRIBUTOR_CACHE_TTL_MS) return null
    if (!parsed.contributors.every(isContributor)) return null
    return parsed.contributors
  } catch {
    return null
  }
}

export function writeContributorCache(
  storage: StorageWriter,
  contributors: Contributor[],
  now = Date.now(),
) {
  try {
    const cache: ContributorCache = { savedAt: now, contributors }
    storage.setItem(CONTRIBUTOR_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // The contributor wall remains useful when storage is unavailable.
  }
}

export async function fetchGitHubContributors(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Contributor[]> {
  const response = await fetcher(CONTRIBUTORS_URL, {
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error('GitHub contributors request failed with ' + response.status)
  }

  return normalizeContributors(await response.json())
}
~~~

- [ ] **Step 4: Run the data-layer tests**

Run:

~~~powershell
pnpm test -- src/lib/githubContributors.test.ts
~~~

Expected: seven tests pass.

- [ ] **Step 5: Run all landing tests and commit**

~~~powershell
pnpm test
git add landing/src/lib/githubContributors.ts landing/src/lib/githubContributors.test.ts
git commit -m "feat: add GitHub contributor data layer"
~~~

Expected: all landing tests pass and the commit contains only the contributor data layer.

---

### Task 3: Render the contributor wall with explicit UI states

**Files:**

- Create: landing/src/components/ContributorWall.test.tsx
- Create: landing/src/components/ContributorWall.tsx

**Interfaces:**

- Consumes: Contributor, fetchGitHubContributors, readContributorCache, and writeContributorCache from Task 2.
- Produces: ContributorWallState union with loading, ready, and error states.
- Produces: ContributorWallView({ state }): JSX.Element for deterministic rendering.
- Produces: ContributorWall(): JSX.Element for browser loading and cache orchestration.
- Consumed by: ContributorPage.tsx in Task 4.

- [ ] **Step 1: Write failing render-state tests**

Create landing/src/components/ContributorWall.test.tsx:

~~~tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContributorWallView } from './ContributorWall'

describe('ContributorWallView', () => {
  it('renders a quiet loading state', () => {
    const html = renderToStaticMarkup(<ContributorWallView state={{ status: 'loading' }} />)
    expect(html).toContain('Loading GitHub contributors')
  })

  it('renders an actionable failure state', () => {
    const html = renderToStaticMarkup(<ContributorWallView state={{ status: 'error' }} />)
    expect(html).toContain('Profiles are taking a break')
    expect(html).toContain('https://github.com/nannndev/beacon/graphs/contributors')
  })

  it('invites the next contributor when GitHub returns no users', () => {
    const html = renderToStaticMarkup(
      <ContributorWallView state={{ status: 'ready', contributors: [] }} />,
    )
    expect(html).toContain('You could be the next contributor')
  })

  it('renders a linked profile with an exact contribution count', () => {
    const html = renderToStaticMarkup(
      <ContributorWallView
        state={{
          status: 'ready',
          contributors: [
            {
              login: 'ada',
              profileUrl: 'https://github.com/ada',
              avatarUrl: 'https://avatars.githubusercontent.com/u/1',
              contributions: 12,
            },
          ],
        }}
      />,
    )
    expect(html).toContain('href="https://github.com/ada"')
    expect(html).toContain('@ada')
    expect(html).toContain('12 contributions')
  })
})
~~~

- [ ] **Step 2: Run the focused tests and confirm the component is missing**

Run:

~~~powershell
cd landing
pnpm test -- src/components/ContributorWall.test.tsx
~~~

Expected: FAIL because ./ContributorWall does not exist.

- [ ] **Step 3: Implement the wall view and browser orchestration**

Create landing/src/components/ContributorWall.tsx:

~~~tsx
import { useEffect, useState } from 'react'
import { ArrowUpRight, Github } from 'lucide-react'
import {
  fetchGitHubContributors,
  readContributorCache,
  writeContributorCache,
  type Contributor,
} from '../lib/githubContributors'

const CONTRIBUTORS_URL = 'https://github.com/nannndev/beacon/graphs/contributors'

export type ContributorWallState =
  | { status: 'loading' }
  | { status: 'ready'; contributors: Contributor[] }
  | { status: 'error' }

interface ContributorWallViewProps {
  state: ContributorWallState
}

export function ContributorWallView({ state }: ContributorWallViewProps) {
  if (state.status === 'loading') {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading GitHub contributors</span>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="h-24 animate-pulse rounded-2xl border border-border/70 bg-muted/40"
            />
          ))}
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-card/55 p-8 text-center">
        <Github className="mx-auto h-6 w-6 text-cyan-500" aria-hidden="true" />
        <h3 className="mt-3 text-lg font-semibold">Profiles are taking a break</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
          GitHub may be offline or rate limited. The contributor history is still available
          directly in the repository.
        </p>
        <a
          href={CONTRIBUTORS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-500 hover:text-cyan-400"
        >
          View contributors on GitHub <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    )
  }

  if (state.contributors.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-cyan-500/30 bg-cyan-500/5 p-8 text-center">
        <h3 className="text-lg font-semibold">You could be the next contributor</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a contribution track above and help shape Beacon.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {state.contributors.map((contributor) => (
        <a
          key={contributor.login}
          href={contributor.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-card/70 p-3 transition-all hover:-translate-y-0.5 hover:border-cyan-500/40 hover:shadow-lg"
        >
          <img
            src={contributor.avatarUrl}
            alt={contributor.login + ' GitHub avatar'}
            width="48"
            height="48"
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-12 w-12 shrink-0 rounded-xl bg-muted object-cover"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold group-hover:text-cyan-500">
              @{contributor.login}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {contributor.contributions}{' '}
              {contributor.contributions === 1 ? 'contribution' : 'contributions'}
            </span>
          </span>
        </a>
      ))}
    </div>
  )
}

export function ContributorWall() {
  const [state, setState] = useState<ContributorWallState>({ status: 'loading' })

  useEffect(() => {
    const cached = readContributorCache(window.sessionStorage)
    if (cached) {
      setState({ status: 'ready', contributors: cached })
      return
    }

    const controller = new AbortController()
    fetchGitHubContributors(controller.signal)
      .then((contributors) => {
        writeContributorCache(window.sessionStorage, contributors)
        setState({ status: 'ready', contributors })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({ status: 'error' })
      })

    return () => controller.abort()
  }, [])

  return <ContributorWallView state={state} />
}
~~~

- [ ] **Step 4: Verify all explicit wall states**

Run:

~~~powershell
pnpm test -- src/components/ContributorWall.test.tsx
pnpm test
~~~

Expected: four wall tests pass and the entire landing test suite remains green.

- [ ] **Step 5: Commit the contributor wall**

~~~powershell
git add landing/src/components/ContributorWall.tsx landing/src/components/ContributorWall.test.tsx
git commit -m "feat: add resilient contributor wall"
~~~

---

### Task 4: Build the static Contributor Portal entry

**Files:**

- Create: landing/src/pages/ContributorPage.tsx
- Create: landing/src/contributors.tsx
- Create: landing/contributors/index.html
- Modify: landing/vite.config.ts
- Modify: landing/tailwind.config.js

**Interfaces:**

- Consumes: ContributorWall from Task 3 and existing BrandMark, ThemeToggle, and NetworkBackground components.
- Produces: a direct /contributors/ page and dist/contributors/index.html build artifact.
- Produces: metadata title "Contribute to Beacon â€” Open-source API testing".

- [ ] **Step 1: Add a failing build assertion for the second HTML entry**

Run:

~~~powershell
cd landing
pnpm build
if (Test-Path dist/contributors/index.html) { exit 0 } else { Write-Error 'Missing contributor entry'; exit 1 }
~~~

Expected: FAIL with Missing contributor entry.

- [ ] **Step 2: Create the contributor HTML and React entry**

Create landing/contributors/index.html:

~~~html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Contribute to Beacon â€” Open-source API testing</title>
    <meta
      name="description"
      content="Contribute code, docs, design, testing, bug reports, or security research to Beacon."
    />
    <meta property="og:title" content="Contribute to Beacon" />
    <meta
      property="og:description"
      content="Choose a contribution path and help build a clearer API testing workspace."
    />
    <meta property="og:type" content="website" />
    <script>
      (function () {
        try {
          var theme = localStorage.getItem('theme') || 'dark';
          document.documentElement.classList.toggle('dark', theme === 'dark');
        } catch (error) {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/contributors.tsx"></script>
  </body>
</html>
~~~

Create landing/src/contributors.tsx:

~~~tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import ContributorPage from './pages/ContributorPage'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ContributorPage />
  </React.StrictMode>,
)
~~~

- [ ] **Step 3: Create the approved Contributor Portal page**

Create landing/src/pages/ContributorPage.tsx:

~~~tsx
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bug,
  Code2,
  FileText,
  Github,
  Palette,
  ShieldCheck,
  TestTube2,
} from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { ContributorWall } from '../components/ContributorWall'
import { NetworkBackground } from '../components/NetworkBackground'
import { ThemeToggle } from '../components/ThemeToggle'

const GITHUB_URL =
  (import.meta as any).env?.VITE_GITHUB_URL || 'https://github.com/nannndev/beacon'
const DOCS_URL = (import.meta as any).env?.VITE_DOCS_URL || 'http://localhost:5174/docs/'

const TRACKS = [
  {
    icon: Code2,
    title: 'Code',
    body: 'Fix a focused problem or build an agreed feature across Beacon desktop, web, or backend.',
    action: 'Browse open issues',
    href: GITHUB_URL + '/issues',
  },
  {
    icon: FileText,
    title: 'Documentation',
    body: 'Clarify setup, concepts, workflows, examples, and the details that save someone an hour.',
    action: 'Report a docs gap',
    href: GITHUB_URL + '/issues/new?template=documentation.yml',
  },
  {
    icon: Palette,
    title: 'Design',
    body: 'Improve interaction, visual hierarchy, accessibility, or propose a better user flow.',
    action: 'Propose a design',
    href: GITHUB_URL + '/issues/new?template=feature_request.yml',
  },
  {
    icon: TestTube2,
    title: 'Testing',
    body: 'Exercise releases, edge cases, platforms, imports, scenarios, and load-test behavior.',
    action: 'Share test results',
    href: GITHUB_URL + '/issues/new?template=testing_report.yml',
  },
  {
    icon: Bug,
    title: 'Bug reports',
    body: 'Turn an unexpected result into clear reproduction steps with sanitized evidence.',
    action: 'Report a bug',
    href: GITHUB_URL + '/issues/new?template=bug_report.yml',
  },
  {
    icon: ShieldCheck,
    title: 'Security',
    body: 'Privately disclose a vulnerability in Beacon. Never publish credentials or exploit details.',
    action: 'Report privately',
    href: GITHUB_URL + '/security/advisories/new',
  },
]

const STEPS = [
  {
    number: '01',
    title: 'Choose or discuss',
    body: 'Pick a track, check existing issues, and discuss major changes before investing deeply.',
  },
  {
    number: '02',
    title: 'Build and verify',
    body: 'Keep the change focused, protect secrets, and run the checks for every area you touched.',
  },
  {
    number: '03',
    title: 'Open a clear PR',
    body: 'Explain the problem, the solution, verification results, and add screenshots for visual work.',
  },
]

const RULES = [
  'Use Beacon only against systems you own or are explicitly authorized to test.',
  'Remove bearer tokens, JWTs, target details, logs, and operational config before sharing.',
  'Keep changes focused and document the exact commands used to verify them.',
  'Testing-engine changes must stay synchronized across both Python implementations.',
  'Treat contributors respectfully and report conduct or security concerns privately.',
]

export default function ContributorPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground selection:bg-cyan-500/30">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(#111_0.6px,transparent_1px)] bg-[length:3px_3px] dark:bg-[radial-gradient(#222_0.6px,transparent_1px)]"
      />
      <NetworkBackground />

      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
          <a href="/" className="flex items-center gap-2.5" aria-label="Beacon home">
            <BrandMark size="md" />
            <span className="text-lg font-extrabold tracking-tight">Beacon</span>
          </a>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card/70 px-4 text-sm font-semibold transition-colors hover:bg-muted"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>

      <section className="relative mx-auto max-w-7xl px-5 pb-20 pt-14 lg:px-8 lg:pb-28 lg:pt-24">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 -z-10 mx-auto h-96 max-w-4xl bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_68%)]"
        />
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Beacon
        </a>
        <div className="mt-12 max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-4 py-1 font-mono text-xs font-bold uppercase tracking-[0.18em] text-cyan-500">
            Open source, built in public
          </div>
          <h1 className="mt-6 text-balance text-5xl font-semibold leading-none tracking-[-0.045em] sm:text-6xl lg:text-8xl">
            Help make every API call clearer.
          </h1>
          <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
            Contribution is more than code. Improve a guide, test a release, sharpen an
            interaction, report a bug, or help protect Beacon.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="#tracks"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-7 text-sm font-bold text-background transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              Start contributing <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href={GITHUB_URL + '/blob/main/CONTRIBUTING.md'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-7 text-sm font-semibold transition-all hover:bg-muted"
            >
              Read the full guide <BookOpen className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <section id="tracks" aria-labelledby="tracks-title" className="border-y border-border/60 bg-muted/15">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-500">
            Choose your track
          </p>
          <h2 id="tracks-title" className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
            Start where your experience is useful.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {TRACKS.map(({ icon: Icon, title, body, action, href }) => (
              <article
                key={title}
                className="group flex min-h-64 flex-col rounded-3xl border border-border/70 bg-background/85 p-6 transition-all hover:-translate-y-1 hover:border-cyan-500/35 hover:shadow-xl"
              >
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-500/10 text-cyan-500">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-6 text-xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{body}</p>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-foreground group-hover:text-cyan-500"
                >
                  {action} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="process-title" className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-500">
              A focused path
            </p>
            <h2 id="process-title" className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              From idea to merged.
            </h2>
            <p className="mt-5 max-w-md leading-7 text-muted-foreground">
              Small, well-explained changes are easier to review and safer to ship.
            </p>
          </div>
          <ol className="grid gap-4">
            {STEPS.map((step) => (
              <li key={step.number} className="grid gap-4 rounded-2xl border border-border bg-card/65 p-6 sm:grid-cols-[64px_1fr]">
                <span className="font-mono text-sm font-bold text-cyan-500">{step.number}</span>
                <span>
                  <span className="block text-lg font-semibold">{step.title}</span>
                  <span className="mt-2 block text-sm leading-6 text-muted-foreground">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="rules-title" className="border-y border-border/60 bg-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-24">
          <div>
            <ShieldCheck className="h-8 w-8 text-cyan-400" aria-hidden="true" />
            <h2 id="rules-title" className="mt-5 text-4xl font-semibold tracking-tight">
              Rules that protect the project.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-slate-400">
              Beacon is a security-adjacent tool. Clear authorization and clean evidence are
              part of a good contribution.
            </p>
          </div>
          <ul className="grid gap-3">
            {RULES.map((rule, index) => (
              <li key={rule} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <span className="font-mono text-xs font-bold text-cyan-400">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-sm leading-6 text-slate-300">{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="contributors-title" className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
        <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-500">
              GitHub contributors
            </p>
            <h2 id="contributors-title" className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              People shipping Beacon.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground md:text-right">
            This wall reflects public repository contributions. Community support, testing,
            design discussion, and issue triage matter too.
          </p>
        </div>
        <ContributorWall />
      </section>

      <section className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto max-w-4xl px-5 py-20 text-center lg:px-8">
          <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Ready to leave Beacon better than you found it?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Read the guide, choose a focused issue, and tell reviewers exactly how you verified
            the result.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href={GITHUB_URL + '/issues'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-7 text-sm font-bold text-background"
            >
              Explore open issues <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-7 text-sm font-semibold hover:bg-muted"
            >
              Read the docs <BookOpen className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between lg:px-8">
          <a href="/" className="flex items-center gap-2 font-semibold text-foreground">
            <BrandMark size="sm" animated={false} /> Beacon
          </a>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
            <a href="/" className="hover:text-foreground">Home</a>
            <a href={GITHUB_URL + '/blob/main/CONTRIBUTING.md'} className="hover:text-foreground">
              Contribution guide
            </a>
            <a href={GITHUB_URL + '/security'} className="hover:text-foreground">Security</a>
            <a href={GITHUB_URL} className="hover:text-foreground">GitHub</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
~~~

- [ ] **Step 4: Register both Vite entries and Tailwind content roots**

Add this build block inside the object returned by landing/vite.config.ts:

~~~ts
build: {
  rollupOptions: {
    input: {
      main: path.resolve(__dirname, 'index.html'),
      contributors: path.resolve(__dirname, 'contributors/index.html'),
    },
  },
},
~~~

Change the content array in landing/tailwind.config.js to:

~~~js
content: [
  "./index.html",
  "./contributors/**/*.html",
  "./src/**/*.{js,ts,jsx,tsx}",
],
~~~

- [ ] **Step 5: Verify tests, type checking, and both production entries**

Run:

~~~powershell
pnpm test
pnpm build
if (-not (Test-Path dist/index.html)) { throw 'Missing landing entry' }
if (-not (Test-Path dist/contributors/index.html)) { throw 'Missing contributor entry' }
Select-String -Path dist/contributors/index.html -Pattern 'Contribute to Beacon'
~~~

Expected: all tests pass, Vite build succeeds, and both HTML files exist.

- [ ] **Step 6: Commit the contributor page**

~~~powershell
git add landing/contributors/index.html landing/src/contributors.tsx landing/src/pages/ContributorPage.tsx landing/vite.config.ts landing/tailwind.config.js
git commit -m "feat: add contributor portal landing page"
~~~

---

### Task 5: Add contributor entry points to the existing landing page

**Files:**

- Modify: landing/src/pages/LandingPage.tsx

**Interfaces:**

- Consumes: the /contributors/ artifact from Task 4.
- Preserves: section-observer behavior for NAV_LINKS and the existing mobile menu.
- Produces: contributor links in desktop navigation, mobile navigation, support, and footer.

- [ ] **Step 1: Confirm the contributor route is absent from the landing source**

Run:

~~~powershell
$matches = Select-String -Path landing/src/pages/LandingPage.tsx -Pattern '/contributors/'
if ($matches) { throw 'Contributor link already exists' } else { Write-Output 'Contributor link absent as expected' }
~~~

Expected: Contributor link absent as expected.

- [ ] **Step 2: Add the desktop and mobile navigation links**

Immediately after the desktop NAV_LINKS map in the header navigation, add:

~~~tsx
<a
  href="/contributors/"
  className="rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
>
  Contributors
</a>
~~~

Immediately after the mobile NAV_LINKS map, add:

~~~tsx
<a
  href="/contributors/"
  onClick={() => setMobileOpen(false)}
  className="rounded-xl px-3 py-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
>
  Contributors
</a>
~~~

- [ ] **Step 3: Make contribution a first-class support action**

Replace the support paragraph with:

~~~tsx
<p className="mt-4 text-lg text-muted-foreground">
  Fund the work, improve the code, sharpen the documentation, test a release, or
  help the community find the next good idea.
</p>
~~~

Add this action before the existing Buy me a coffee action:

~~~tsx
<a
  href="/contributors/"
  className="inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-7 text-[15px] font-bold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
>
  <GitBranch className="h-5 w-5" /> Contribute to Beacon
</a>
~~~

Change the existing action container to:

~~~tsx
<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
~~~

This lets three actions wrap cleanly at intermediate widths. Keep the existing
financial-support and Discord actions unchanged.

- [ ] **Step 4: Add the footer link**

Add this link before Support in the footer link group:

~~~tsx
<a href="/contributors/" className="hover:text-foreground">Contributors</a>
~~~

- [ ] **Step 5: Verify all four entry points and rebuild**

Run:

~~~powershell
$matches = Select-String -Path landing/src/pages/LandingPage.tsx -Pattern '/contributors/'
if ($matches.Count -ne 4) { throw ('Expected 4 contributor links, found ' + $matches.Count) }
cd landing
pnpm test
pnpm build
~~~

Expected: exactly four source links, all tests pass, and both landing entries build.

- [ ] **Step 6: Commit landing integration**

~~~powershell
git add landing/src/pages/LandingPage.tsx
git commit -m "feat: link landing page to contributor portal"
~~~

---

### Task 6: Add canonical GitHub community standards

**Files:**

- Create: CONTRIBUTING.md
- Create: CODE_OF_CONDUCT.md
- Create: SECURITY.md
- Create: .github/ISSUE_TEMPLATE/config.yml
- Create: .github/ISSUE_TEMPLATE/bug_report.yml
- Create: .github/ISSUE_TEMPLATE/feature_request.yml
- Create: .github/ISSUE_TEMPLATE/documentation.yml
- Create: .github/ISSUE_TEMPLATE/testing_report.yml
- Create: .github/PULL_REQUEST_TEMPLATE.md
- Create: scripts/validate-community-files.mjs
- Modify: package.json
- Modify: pnpm-lock.yaml
- Modify: docs/development.md

**Interfaces:**

- Produces: pnpm test:community for local validation.
- Produces: GitHub issue chooser entries for bug, feature/design, documentation, and testing reports.
- Produces: private security contact URL at /security/advisories/new.
- Consumed by: Contributor Portal calls to action and future contributors.

- [ ] **Step 1: Install YAML validation and register the command**

Run from the repository root:

~~~powershell
pnpm add -D yaml@^2.6.1
~~~

Add this script to the root package.json:

~~~json
"test:community": "node scripts/validate-community-files.mjs"
~~~

- [ ] **Step 2: Create the deterministic validator**

Create scripts/validate-community-files.mjs:

~~~js
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'

const markdownFiles = [
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
]

const issueForms = [
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/documentation.yml',
  '.github/ISSUE_TEMPLATE/testing_report.yml',
]

async function read(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8')
}

for (const path of markdownFiles) {
  const content = await read(path)
  if (content.trim().length < 120) {
    throw new Error(path + ' is unexpectedly short')
  }
}

for (const path of issueForms) {
  const document = YAML.parseDocument(await read(path))
  if (document.errors.length > 0) {
    throw new Error(path + ': ' + document.errors.map((error) => error.message).join('; '))
  }
  const form = document.toJS()
  if (
    typeof form.name !== 'string' ||
    typeof form.description !== 'string' ||
    !Array.isArray(form.body) ||
    form.body.length < 3
  ) {
    throw new Error(path + ' is missing required issue-form fields')
  }
}

const configDocument = YAML.parseDocument(
  await read('.github/ISSUE_TEMPLATE/config.yml'),
)
if (configDocument.errors.length > 0) {
  throw new Error(configDocument.errors.map((error) => error.message).join('; '))
}
const config = configDocument.toJS()
const contactLinks = Array.isArray(config.contact_links) ? config.contact_links : []
if (
  !contactLinks.some(
    (link) =>
      typeof link?.url === 'string' &&
      link.url === 'https://github.com/nannndev/beacon/security/advisories/new',
  )
) {
  throw new Error('Issue chooser must link to private GitHub Security Advisories')
}

console.log('Community files valid: ' + (markdownFiles.length + issueForms.length + 1))
~~~

- [ ] **Step 3: Run validation and prove canonical files are still missing**

Run:

~~~powershell
pnpm test:community
~~~

Expected: FAIL with ENOENT for CONTRIBUTING.md.

- [ ] **Step 4: Create the contribution guide**

Create CONTRIBUTING.md:

~~~~markdown
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

~~~bash
corepack enable
pnpm install
pnpm --dir frontend install
pnpm --dir landing install
~~~

Run the current stack:

~~~bash
pnpm dev
~~~

Run individual surfaces when needed:

~~~bash
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
~~~

For legacy Flask work:

~~~bash
pip install -r requirements.txt
python app.py
~~~

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
~~~~

- [ ] **Step 5: Create conduct and security policies**

Create CODE_OF_CONDUCT.md:

~~~markdown
# Code of Conduct

## Our commitment

We are committed to a welcoming, safe, and useful community for everyone,
regardless of experience, identity, background, or role.

## Expected behavior

- Be respectful, specific, and patient.
- Critique ideas and code, not people.
- Assume good intent while accepting correction.
- Protect private information and disclose conflicts of interest.
- Help keep security and authorized-testing discussions responsible.

## Unacceptable behavior

Harassment, discrimination, threats, sexualized attention, deliberate
intimidation, doxxing, credential sharing, and encouraging unauthorized access
are not acceptable. Publishing a private conduct or security report is also not
acceptable.

## Scope

This policy applies in repository issues, pull requests, reviews, discussions,
project chat, and public spaces when someone represents Beacon.

## Reporting and enforcement

Do not open a public issue containing sensitive conduct details. Contact the
maintainer privately. Until a dedicated conduct address is published, use a
private [GitHub Security Advisory](https://github.com/nannndev/beacon/security/advisories/new)
and begin the report with "Conduct report" so it can be routed correctly.

Maintainers will review reports in good faith, protect confidentiality where
possible, and may edit or remove content, reject contributions, issue warnings,
or temporarily or permanently restrict participation. Enforcement decisions
will consider context, impact, and patterns of behavior.

Retaliation against someone who makes a good-faith report is prohibited.
~~~

Create SECURITY.md:

~~~markdown
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
~~~

- [ ] **Step 6: Create the issue chooser and four issue forms**

Create .github/ISSUE_TEMPLATE/config.yml:

~~~yaml
blank_issues_enabled: false
contact_links:
  - name: Report a security vulnerability privately
    url: https://github.com/nannndev/beacon/security/advisories/new
    about: Do not publish vulnerability details, credentials, or exploit evidence in an issue.
  - name: Contribution guide
    url: https://github.com/nannndev/beacon/blob/main/CONTRIBUTING.md
    about: Read setup, safety, testing, and pull request expectations.
  - name: Community conduct
    url: https://github.com/nannndev/beacon/blob/main/CODE_OF_CONDUCT.md
    about: Review the behavior expected in Beacon project spaces.
~~~

Create .github/ISSUE_TEMPLATE/bug_report.yml:

~~~yaml
name: Bug report
description: Report a reproducible problem in Beacon.
title: "[Bug]: "
labels: ["bug", "triage"]
body:
  - type: markdown
    attributes:
      value: "Remove tokens, JWTs, credentials, private URLs, and customer data before submitting."
  - type: input
    id: version
    attributes:
      label: Beacon version or commit
      placeholder: "v0.4.0 or commit abc1234"
    validations:
      required: true
  - type: dropdown
    id: component
    attributes:
      label: Component
      options:
        - Desktop app
        - React frontend
        - FastAPI backend
        - Legacy Flask app
        - Landing site
        - Documentation
        - MCP server
    validations:
      required: true
  - type: input
    id: environment
    attributes:
      label: Platform and environment
      placeholder: "Windows 11, desktop x64, Local environment"
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Reproduction steps
      description: Provide the smallest repeatable sequence.
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual behavior and sanitized evidence
    validations:
      required: true
  - type: checkboxes
    id: safety
    attributes:
      label: Safety confirmation
      options:
        - label: I removed credentials, tokens, private endpoints, and customer data.
          required: true
        - label: Any target interaction described here was explicitly authorized.
          required: true
~~~

Create .github/ISSUE_TEMPLATE/feature_request.yml:

~~~yaml
name: Feature or design proposal
description: Propose a user outcome, interaction, or product improvement.
title: "[Proposal]: "
labels: ["enhancement", "triage"]
body:
  - type: markdown
    attributes:
      value: "Major behavior or architecture changes should be discussed before implementation."
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: Explain who is blocked and why the current workflow is insufficient.
    validations:
      required: true
  - type: textarea
    id: outcome
    attributes:
      label: Desired outcome
      description: Describe observable success without prescribing unnecessary implementation.
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed approach
      description: Include interaction details, mockups, or technical tradeoffs when relevant.
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
    validations:
      required: true
  - type: checkboxes
    id: scope
    attributes:
      label: Scope confirmation
      options:
        - label: I checked for an existing issue or pull request covering this proposal.
          required: true
        - label: I am willing to help validate or implement this change.
          required: false
~~~

Create .github/ISSUE_TEMPLATE/documentation.yml:

~~~yaml
name: Documentation improvement
description: Report missing, incorrect, or unclear Beacon documentation.
title: "[Docs]: "
labels: ["documentation", "triage"]
body:
  - type: input
    id: page
    attributes:
      label: Affected page or file
      placeholder: "docs/getting-started.md"
    validations:
      required: true
  - type: textarea
    id: problem
    attributes:
      label: What is unclear or incorrect?
    validations:
      required: true
  - type: textarea
    id: correction
    attributes:
      label: Suggested correction or missing example
    validations:
      required: true
  - type: checkboxes
    id: contribution
    attributes:
      label: Contribution
      options:
        - label: I am willing to submit a pull request for this documentation change.
          required: false
~~~

Create .github/ISSUE_TEMPLATE/testing_report.yml:

~~~yaml
name: Testing and QA report
description: Share a reproducible release, platform, workflow, or edge-case test result.
title: "[Testing]: "
labels: ["testing", "triage"]
body:
  - type: input
    id: build
    attributes:
      label: Build, version, or commit
      placeholder: "v0.4.0 desktop x64"
    validations:
      required: true
  - type: input
    id: environment
    attributes:
      label: Platform and environment
      placeholder: "Windows 11, FastAPI backend, Local environment"
    validations:
      required: true
  - type: textarea
    id: area
    attributes:
      label: Area and test objective
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Test steps
    validations:
      required: true
  - type: textarea
    id: result
    attributes:
      label: Result and sanitized evidence
    validations:
      required: true
  - type: checkboxes
    id: safety
    attributes:
      label: Safety confirmation
      options:
        - label: I removed credentials, tokens, private endpoints, and customer data.
          required: true
        - label: Any target testing described here was explicitly authorized.
          required: true
~~~

- [ ] **Step 7: Create the pull request template**

Create .github/PULL_REQUEST_TEMPLATE.md:

~~~~markdown
## Problem

What user or maintainer problem does this solve?

## Solution

Describe the focused change and important tradeoffs.

## Change type

- [ ] Code
- [ ] Documentation
- [ ] Design or UI
- [ ] Testing or tooling
- [ ] Security hardening

## Verification

List the exact commands and results:

~~~text
pnpm test
pnpm build
~~~

## Visual evidence

For visual changes, attach before/after screenshots at relevant desktop and
mobile widths. Remove tokens, private URLs, and customer data.

## Checklist

- [ ] The scope is focused and unrelated changes are excluded.
- [ ] Tests or verification cover the changed behavior.
- [ ] Documentation is updated when behavior or setup changed.
- [ ] No credentials, JWTs, operational config, private endpoints, or customer data are included.
- [ ] Any target testing was explicitly authorized.
- [ ] If shared testing-engine behavior changed, both Python engine files were synchronized while preserving extractor support.
- [ ] I have read and followed CONTRIBUTING.md and CODE_OF_CONDUCT.md.

Mark only the items that apply and explain any exception in the pull request.
~~~~

- [ ] **Step 8: Link the existing development guide to canonical policies**

Replace the Contributing section in docs/development.md with:

~~~markdown
## Contributing

Start with the [contribution guide](https://github.com/nannndev/beacon/blob/main/CONTRIBUTING.md)
for setup, safety, testing, and pull request expectations. Use the issue chooser
for bugs, documentation, design proposals, and QA reports.

Report vulnerabilities privately according to the
[security policy](https://github.com/nannndev/beacon/blob/main/SECURITY.md), and
follow the [Code of Conduct](https://github.com/nannndev/beacon/blob/main/CODE_OF_CONDUCT.md)
in every project space.
~~~

- [ ] **Step 9: Validate and commit all community standards**

Run:

~~~powershell
pnpm test:community
git diff --check
~~~

Expected: Community files valid: 9 and no whitespace errors.

Commit:

~~~powershell
git add CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md .github package.json pnpm-lock.yaml scripts/validate-community-files.mjs docs/development.md
git commit -m "docs: add contributor community standards"
~~~

---

### Task 7: Run full verification and visual QA

**Files:**

- Verify: all files changed by Tasks 1-6.
- Modify only if QA exposes a concrete defect: the smallest owning file.

**Interfaces:**

- Confirms: both static entries, all unit tests, community-file validation, direct routes, themes, responsive layout, contributor states, and private security links.
- Produces: a clean branch ready for review and publication.

- [ ] **Step 1: Run the complete automated verification**

Run from the repository root:

~~~powershell
pnpm test:community
pnpm --dir landing test
pnpm --dir landing build
git diff --check
~~~

Expected:

- Community files valid: 9.
- All landing tests pass.
- Vite emits dist/index.html and dist/contributors/index.html.
- git diff --check prints no errors.

- [ ] **Step 2: Verify the built files and security destinations**

Run:

~~~powershell
if (-not (Test-Path landing/dist/index.html)) { throw 'Missing landing build' }
if (-not (Test-Path landing/dist/contributors/index.html)) { throw 'Missing contributors build' }
if (-not (Select-String -Path landing/src/pages/ContributorPage.tsx -SimpleMatch "'/security/advisories/new'")) {
  throw 'Contributor page is missing the private advisory path'
}
$securityFiles = @('.github/ISSUE_TEMPLATE/config.yml', 'SECURITY.md')
foreach ($file in $securityFiles) {
  if (-not (Select-String -Path $file -SimpleMatch 'https://github.com/nannndev/beacon/security/advisories/new')) {
    throw ('Missing private advisory URL in ' + $file)
  }
}
~~~

Expected: both build artifacts exist and all three security surfaces use the private advisory URL.

- [ ] **Step 3: Serve the production build and verify direct navigation**

Start the preview server:

~~~powershell
pnpm --dir landing preview --host 127.0.0.1 --port 4175
~~~

From a second shell:

~~~powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4175/).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4175/contributors/).StatusCode
~~~

Expected: both requests return 200.

- [ ] **Step 4: Perform browser and accessibility QA**

Inspect these exact viewport states:

- 1536 x 1000, dark theme: track cards form a balanced three-column grid and the contributor wall uses four columns.
- 900 x 900, dark theme: tracks use two columns and process content remains readable.
- 390 x 844, dark theme: all sections stack, no horizontal overflow appears, and buttons remain at least 44 px tall.
- 390 x 844, light theme: foreground, borders, cyan accents, and focus rings retain readable contrast.

For both / and /contributors/:

- Tab through every interactive element and confirm visible focus.
- Open Contributors from desktop navigation, mobile navigation, support, and footer.
- Use browser back and forward navigation.
- Confirm avatar alternative text, heading order, and descriptive security link copy.
- Confirm the contributor skeleton is announced politely and error/empty states remain understandable from the component tests.

Expected: no clipping, inaccessible focus, misleading action, or broken navigation.

- [ ] **Step 5: Re-run verification after any visual correction**

If QA required a source correction, stage only the owning files and run:

~~~powershell
pnpm --dir landing test
pnpm --dir landing build
pnpm test:community
git diff --check
git commit -m "fix: polish contributor portal verification"
~~~

If QA required no correction, do not create an empty commit.

- [ ] **Step 6: Review the final branch**

Run:

~~~powershell
git status --short --branch
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
~~~

Expected: the branch contains the approved design checkpoint, implementation commits from Tasks 1-6, no uncommitted product changes, and only contributor-related files.

---

## Completion Criteria

- The root landing page and /contributors/ build and load directly.
- Six contribution tracks have accurate destinations.
- Contributor profiles load from GitHub without credentials, filter bots, cache for 30 minutes, abort safely, and expose loading, empty, and failure states.
- GitHub offers structured bug, feature/design, documentation, and testing forms.
- Security disclosures are private and authorized-testing boundaries are explicit.
- CONTRIBUTING.md documents both Python engine copies and secret handling.
- Tests, build, YAML validation, responsive checks, theme checks, keyboard checks, and direct-link checks pass.
