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
    code: 'CODE',
    icon: Code2,
    title: 'Code',
    body: 'Fix a focused problem or build an agreed feature across Beacon desktop, web, or backend.',
    action: 'Browse open issues',
    href: GITHUB_URL + '/issues',
  },
  {
    code: 'DOCS',
    icon: FileText,
    title: 'Documentation',
    body: 'Clarify setup, concepts, workflows, examples, and the details that save someone an hour.',
    action: 'Report a docs gap',
    href: GITHUB_URL + '/issues/new?template=documentation.yml',
  },
  {
    code: 'UX',
    icon: Palette,
    title: 'Design',
    body: 'Improve interaction, visual hierarchy, accessibility, or propose a better user flow.',
    action: 'Propose a design',
    href: GITHUB_URL + '/issues/new?template=feature_request.yml',
  },
  {
    code: 'QA',
    icon: TestTube2,
    title: 'Testing',
    body: 'Exercise releases, edge cases, platforms, imports, scenarios, and load-test behavior.',
    action: 'Share test results',
    href: GITHUB_URL + '/issues/new?template=testing_report.yml',
  },
  {
    code: 'BUG',
    icon: Bug,
    title: 'Bug reports',
    body: 'Turn an unexpected result into clear reproduction steps with sanitized evidence.',
    action: 'Report a bug',
    href: GITHUB_URL + '/issues/new?template=bug_report.yml',
  },
  {
    code: 'SEC',
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

        <div className="mt-12 grid items-end gap-10 lg:grid-cols-[1fr_300px]">
          <div className="max-w-4xl">
            <div className="inline-flex overflow-hidden rounded-full border border-cyan-500/25 bg-slate-950 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300 shadow-lg">
              <span className="border-r border-white/10 px-3 py-1.5 text-cyan-400">GET</span>
              <span className="border-r border-white/10 px-3 py-1.5">/contributors</span>
              <span className="px-3 py-1.5 text-emerald-400">200 OPEN</span>
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

          <div className="hidden border-l border-border pl-6 font-mono text-xs text-muted-foreground lg:block">
            <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-500">
              Accepted contribution types
            </div>
            {TRACKS.map((track, index) => (
              <div key={track.code} className="flex items-center justify-between border-t border-border/70 py-2.5">
                <span>{String(index + 1).padStart(2, '0')} / {track.code}</span>
                <span className="text-emerald-500">OPEN</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="tracks" aria-labelledby="tracks-title" className="scroll-mt-20 border-y border-border/60 bg-muted/15">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-500">
            Choose your track
          </p>
          <h2 id="tracks-title" className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
            Start where your experience is useful.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {TRACKS.map(({ code, icon: Icon, title, body, action, href }, index) => (
              <article
                key={title}
                className="group flex min-h-64 flex-col rounded-3xl border border-border/70 bg-background/85 p-6 transition-all hover:-translate-y-1 hover:border-cyan-500/35 hover:shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-500/10 text-cyan-500">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-muted-foreground">
                    {String(index + 1).padStart(2, '0')} / {code}
                  </span>
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
