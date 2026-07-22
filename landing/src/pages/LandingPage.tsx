import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Activity,
  Apple,
  ArrowRight,
  Bot,
  Braces,
  Code2,
  Coffee,
  Download,
  FileCode2,
  FolderKanban,
  Github,
  GitBranch,
  Globe2,
  History,
  Menu,
  MessagesSquare,
  PanelsTopLeft,
  Play,
  Repeat,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Terminal,
  Users,
  X,
} from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { BrandMark } from '../components/BrandMark'
import { NetworkBackground } from '../components/NetworkBackground'
import { ContributorWall } from '../components/ContributorWall'
import { HeroStats } from '../components/HeroStats'
import { startDownload } from '../lib/download'
import {
  CountUp,
  Reveal,
  RevealGroup,
  RevealItem,
  motion,
  useReducedMotion,
} from '../components/motion'
import workspaceShot from '../assets/features/workspace.png'
import requestBuilderShot from '../assets/features/request-builder.png'
import responseInspectorShot from '../assets/features/response-inspector.png'
import assertionsShot from '../assets/features/assertions.png'
import environmentsShot from '../assets/features/environments.png'
import scenarioResultsShot from '../assets/features/scenario-results.png'
import runHistoryShot from '../assets/features/run-history.png'

// URLs injected from the root .env via vite.config.ts (define block).
const DOCS_URL =
  (import.meta as any).env?.VITE_DOCS_URL || 'https://nannndev.github.io/beacon/'
const SUPPORT_URL =
  (import.meta as any).env?.VITE_SUPPORT_URL || 'https://buymeacoffee.com/ekaprasety8'
const GITHUB_URL =
  (import.meta as any).env?.VITE_GITHUB_URL || 'https://github.com/nannndev/beacon'
// Beacon community Discord. Override with VITE_DISCORD_URL in the root .env.
const DISCORD_URL =
  (import.meta as any).env?.VITE_DISCORD_URL || 'https://discord.gg/vRn4vw3Qf3'

const NAV_LINKS = [
  { id: 'product-preview', label: 'Product' },
  { id: 'features', label: 'Features' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'mcp', label: 'AI' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'contributors', label: 'Contributors' },
]

const REQUESTS = [
  { method: 'POST', path: '/auth/login', status: 200, time: 48 },
  { method: 'GET', path: '/users/me', status: 200, time: 32 },
  { method: 'PUT', path: '/inventory/items', status: 202, time: 71 },
  { method: 'GET', path: '/reports/daily', status: 429, time: 128 },
  { method: 'POST', path: '/checkout/session', status: 201, time: 64 },
]

const SAMPLE_BODY = `{
  "email": "{{random_email}}",
  "token": "{{access_token}}",
  "trace_id": "{{uuid}}"
}`

export default function LandingPage() {
  // Direct-download the right installer for the visitor's OS (falls back to the
  // releases page). See lib/download.ts.
  const download = () => { void startDownload() }
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('product-preview')
  const [logs, setLogs] = useState<string[]>([
    'Ready. Select a request or run the collection.',
    'Environment: Local / api.beacon.local',
  ])
  const logRef = useRef<HTMLDivElement>(null)

  const current = REQUESTS[selected]
  const successCount = REQUESTS.filter((r) => r.status >= 200 && r.status < 300).length

  const response = useMemo(() => {
    if (current.status === 429) {
      return `{
  "error": "rate_limited",
  "retry_after": 30,
  "message": "Request quota exceeded"
}`
    }
    return `{
  "ok": true,
  "status": ${current.status},
  "request_id": "req_7c42a19",
  "latency_ms": ${current.time}
}`
  }, [current])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    const sections = NAV_LINKS
      .map((link) => document.getElementById(link.id))
      .filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActiveSection(visible.target.id)
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 1] },
    )
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  useEffect(() => {
    if (!running) return
    let i = 0
    setLogs(['Starting collection run...', 'Resolving environment variables...'])
    const id = window.setInterval(() => {
      const req = REQUESTS[i % REQUESTS.length]
      setSelected(i % REQUESTS.length)
      setLogs((prev) => [
        ...prev,
        `${req.method} ${req.path} -> ${req.status} (${req.time}ms)`,
      ].slice(-12))
      i += 1
      if (i >= REQUESTS.length) {
        window.clearInterval(id)
        setRunning(false)
        setLogs((prev) => [...prev, `Run complete. ${successCount}/${REQUESTS.length} requests passed.`])
      }
    }, 620)
    return () => window.clearInterval(id)
  }, [running, successCount])

  const runDemo = () => {
    if (running) {
      setRunning(false)
      setLogs((prev) => [...prev, 'Run stopped.'])
      return
    }
    setRunning(true)
  }

  const resetDemo = () => {
    setRunning(false)
    setSelected(0)
    setLogs(['Ready. Select a request or run the collection.', 'Environment: Local / api.beacon.local'])
  }

  return (
    <main className="min-h-screen w-full max-w-full overflow-x-hidden bg-background text-foreground selection:bg-cyan-500/30">
      {/* Modern subtle background */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(#111_0.6px,transparent_1px)] bg-[length:3px_3px] dark:bg-[radial-gradient(#222_0.6px,transparent_1px)]" />
      <NetworkBackground />
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 shadow-sm backdrop-blur-2xl">
        <div
          className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 lg:px-8"
        >
          <a href="#" className="flex items-center gap-2.5" aria-label="Beacon home">
            <BrandMark size="md" />
            <span className="text-lg font-extrabold tracking-tight">Beacon</span>
          </a>

          <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className={`relative rounded-lg px-3 py-1.5 transition-colors ${
                  activeSection === link.id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {link.label}
                {activeSection === link.id && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan-500"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener"
              title="View source on GitHub"
              className="hidden h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              <Github className="h-5 w-5" />
            </a>

            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener"
              title="Join the Beacon community on Discord"
              aria-label="Join the Beacon Discord"
              className="hidden h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-[#5865F2] sm:inline-flex"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.332-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.332-.946 2.418-2.157 2.418Z" />
              </svg>
            </a>

            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener"
              title="Open full documentation (VitePress)"
              className="hidden items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
            >
              Documentation
            </a>
            <a
              href="#desktop"
              className="hidden items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-4 py-1.5 text-sm font-semibold transition-all hover:border-border hover:bg-muted active:scale-[0.985] sm:inline-flex"
            >
              <Download className="h-4 w-4" />
              Download
            </a>

            <button
              onClick={download}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-bold text-background shadow-sm transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              Download
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              onClick={() => setMobileOpen((open) => !open)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card/60 text-foreground transition-all hover:bg-muted active:scale-[0.97] md:hidden"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="border-t border-border/60 bg-background/95 backdrop-blur-2xl md:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-5 py-4">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.id}
                  href={`#${link.id}`}
                  onClick={() => setMobileOpen(false)}
                  className={`rounded-xl px-3 py-3 text-base font-semibold transition-colors ${
                    activeSection === link.id
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {link.label}
                </a>
              ))}
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-3 py-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Documentation
              </a>
              <div className="mt-2 grid gap-2">
                <button
                  onClick={() => {
                    setMobileOpen(false)
                    download()
                  }}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-bold text-background transition-all active:scale-[0.985]"
                >
                  Download release
                  <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href="#desktop"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-5 text-sm font-semibold transition-all hover:bg-muted active:scale-[0.985]"
                >
                  <Download className="h-4 w-4" />
                  Download Desktop
                </a>
              </div>
            </nav>
          </div>
        )}
      </header>

      <section className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-14 pt-12 lg:px-8 lg:pb-20 lg:pt-20 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,#0a0a0a_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,#111_0%,transparent_65%)]" />

        <RevealGroup className="max-w-2xl" stagger={0.08} delayChildren={0.05}>
          <RevealItem className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-1 text-xs font-semibold tracking-widest text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            FOR API TEAMS &amp; SECURITY RESEARCHERS
          </RevealItem>

          <RevealItem as="div">
            <h1 className="text-balance text-6xl font-semibold leading-[0.98] tracking-[-3.5px] md:text-[68px] md:tracking-[-4px]">
              Clarity for<br /> every API call.
            </h1>
          </RevealItem>

          <RevealItem
            as="div"
            className="mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground"
          >
            Build requests, inspect responses, chain scenarios, and load-test APIs from one local workspace.
          </RevealItem>

          <RevealItem className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={download}
              className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-7 text-[15px] font-semibold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              Download Beacon
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            <a
              href="#desktop"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-6 text-[15px] font-semibold transition-all hover:bg-muted hover:border-border active:scale-[0.985]"
            >
              <Download className="h-4 w-4" />
              Download Desktop
            </a>
          </RevealItem>

          <RevealItem>
            <HeroStats />
          </RevealItem>

          <RevealItem className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[
              { label: 'Data', value: 'Local' },
              { label: 'Runtime', value: 'Bundled' },
              { label: 'Account', value: 'None' },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border bg-card/70 px-3 py-3 transition-colors hover:border-cyan-500/30"
              >
                <div className="font-mono text-xl font-bold tabular-nums">{item.value}</div>
                <div className="mt-1 text-[11px] font-semibold text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </RevealItem>
        </RevealGroup>

        <ProductPreview
          current={current}
          selected={selected}
          response={response}
          logs={logs}
          running={running}
          logRef={logRef}
          onSelect={setSelected}
          onRun={runDemo}
          onReset={resetDemo}
        />
      </section>

      <section id="workspace" className="border-y border-border/60 bg-muted/15">
        <RevealGroup className="mx-auto grid max-w-7xl gap-6 px-5 py-16 lg:grid-cols-4 lg:px-8">
          {[
            { icon: FolderKanban, title: 'Collections', body: 'Keep endpoints grouped by product area, environment, or release.' },
            { icon: Globe2, title: 'Environments', body: 'Switch base URLs and variables without editing every request.' },
            { icon: Braces, title: 'Templating', body: 'Use dynamic values like random email, UUID, timestamp, and tokens.' },
            { icon: History, title: 'Run history', body: 'Inspect response bodies, timing, status, and logs from every run.' },
          ].map(({ icon: Icon, title, body }) => (
            <RevealItem key={title} as="article" className="group rounded-2xl border border-border/70 bg-background/90 p-6 transition-all hover:-translate-y-0.5 hover:border-cyan-500/30 hover:shadow-xl">
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight group-hover:text-cyan-400 transition-colors">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      <FeatureGallery />

      <section id="features" className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <Reveal>
            <p className="text-sm font-bold text-cyan-500">Built for API work</p>
            <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight md:text-5xl">
              A focused workspace that keeps request work visible.
            </h2>
            <p className="mt-5 max-w-lg text-pretty leading-7 text-muted-foreground">
              Beacon stays close to the work: URL, method, auth, payload, response, run config, logs, and the variables that connect them.
            </p>
          </Reveal>

          <RevealGroup className="grid gap-4 sm:grid-cols-2" stagger={0.07}>
            {[
              { icon: Send, title: 'Send & inspect', body: 'Fire one request and read status, timing, headers, and formatted response bodies.' },
              { icon: ShieldCheck, title: 'Assertions', body: 'Check status, response time, body text, JSON fields, or headers on every send.' },
              { icon: GitBranch, title: 'Scenarios', body: 'Chain endpoints in order and pass extracted tokens into the next request.' },
              { icon: FileCode2, title: 'Any content type', body: 'Use JSON, forms, multipart uploads, raw text, XML, or GraphQL with variables.' },
              { icon: Activity, title: 'Live load testing', body: 'Watch attempts, success, rate limits, errors, latency percentiles, and a live trend chart as runs execute.' },
              { icon: Repeat, title: 'Retry & rate control', body: 'Retry failures and tune concurrency, delays, and request limits per endpoint.' },
            ].map(({ icon: Icon, title, body }) => (
              <RevealItem key={title} as="article" className="group rounded-xl border border-border bg-card/55 p-5 transition-all hover:-translate-y-0.5 hover:border-cyan-500/30 hover:bg-card">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500/10 to-teal-500/10 text-cyan-400 transition group-hover:scale-110 group-hover:-rotate-3">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="font-semibold tracking-tight">{title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </section>

      <section id="workflow" className="mx-auto max-w-7xl px-5 pb-20 lg:px-8">
        <Reveal className="rounded-3xl border border-border bg-card/50 p-8 md:p-10">
          <div className="flex flex-col justify-between gap-6 border-b border-border pb-8 md:flex-row md:items-end">
            <div>
              <div className="text-sm font-semibold tracking-widest text-cyan-400">WORKFLOW</div>
              <h2 className="mt-2 text-4xl font-semibold tracking-tight">From idea to production-grade testing.</h2>
            </div>
            <button
              onClick={download}
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-6 text-sm font-semibold transition-all hover:bg-muted"
            >
              Download <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>

          <RevealGroup className="grid gap-4 pt-8 md:grid-cols-4" stagger={0.09}>
            {[
              ['Create', 'Method, URL, headers, body, auth, and dynamic variables.'],
              ['Send & inspect', 'Fire once, read the response, then save a field as a token.'],
              ['Assert', 'Add pass/fail rules on status, time, body, or JSON.'],
              ['Chain & scale', 'Run a complete scenario or load-test with concurrency.'],
            ].map(([title, body], index) => (
              <RevealItem key={title} className="group relative rounded-2xl border border-border/50 bg-background/60 p-6 transition-colors hover:border-cyan-500/30">
                <div className="mb-3 font-mono text-xs font-bold text-cyan-500/70">0{index + 1}</div>
                <div className="text-xl font-semibold tracking-tight">{title}</div>
                <p className="mt-2 text-[15px] leading-snug text-muted-foreground">{body}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </Reveal>
      </section>

      <section id="mcp" className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-1 text-xs font-semibold tracking-widest text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-cyan-400" /> MCP INTEGRATION
            </div>
            <h2 className="mt-4 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
              Drive Beacon with your AI.
            </h2>
            <p className="mt-5 max-w-lg text-pretty leading-7 text-muted-foreground">
              Beacon ships a bundled MCP server. One click in the desktop app registers it
              with Claude. Assistants get{' '}
              <span className="font-semibold text-foreground">
                <CountUp value={17} durationMs={900} /> tools
              </span>{' '}
              to create, organize, import, send &amp; inspect, assert, chain scenarios, and
              load-test endpoints through the same engine, with no glue code.
            </p>
            <a
              href={DOCS_URL.replace(/\/$/, '') + '/mcp'}
              target="_blank"
              rel="noopener"
              className="group mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cyan-500 transition-colors hover:text-cyan-400"
            >
              Read the MCP guide <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </Reveal>

          <Reveal delay={0.1} className="rounded-2xl border border-border bg-slate-950 p-5 font-mono text-xs leading-6 text-slate-200 shadow-xl">
            <div className="mb-3 flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
            </div>
            <pre className="overflow-auto"><code>{`# Desktop app > MCP panel > one click to register
# (or Claude Code, pointing at the bundled binary)
claude mcp add beacon -- <path-to>/mcp_server

# then just ask your assistant:
"send Login, then run the Checkout scenario"
"load-test /reports 100x at concurrency 10"`}</code></pre>
          </Reveal>
        </div>
      </section>

      <section id="desktop" className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="mt-4 text-balance text-5xl font-semibold tracking-tighter">
              Your workspace stays on your machine.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Beacon bundles the interface, FastAPI backend, and MCP server. No hosted Beacon account or Python installation required.
            </p>
          </Reveal>

          <RevealGroup className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-2" stagger={0.1}>
            <RevealItem as="article" className="group flex min-h-72 flex-col rounded-3xl border border-border/70 bg-card/90 p-7 transition-all hover:-translate-y-1 hover:border-cyan-500/35 hover:shadow-2xl md:p-9">
              <div className="flex items-center gap-5">
                <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10">
                  <PanelsTopLeft className="h-8 w-8 text-cyan-500" strokeWidth={1.8} />
                </span>
                <div>
                  <div className="text-2xl font-semibold tracking-tight">Beacon for Windows</div>
                  <div className="mt-1 text-sm text-muted-foreground">Windows 10/11, x64 installer</div>
                </div>
              </div>
              <button
                onClick={() => void startDownload('windows')}
                className="mt-auto flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-6 text-sm font-semibold text-background transition hover:-translate-y-px active:scale-[0.985]"
              >
                <Download className="h-4 w-4" />
                Download EXE
              </button>
            </RevealItem>

            <RevealItem as="article" className="group flex min-h-72 flex-col rounded-3xl border border-border/70 bg-card/90 p-7 transition-all hover:-translate-y-1 hover:border-cyan-500/35 hover:shadow-2xl md:p-9">
              <div className="flex items-center gap-5">
                <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-border bg-foreground text-background">
                  <Apple className="h-8 w-8" strokeWidth={1.8} />
                </span>
                <div>
                  <div className="text-2xl font-semibold tracking-tight">Beacon for macOS</div>
                  <div className="mt-1 text-sm text-muted-foreground">Apple Silicon, unsigned DMG</div>
                </div>
              </div>
              <div className="mt-6 space-y-2 text-sm leading-6 text-muted-foreground">
                <p>First launch: Beacon isn't notarized yet, so macOS may say it's "damaged". It isn't — that's just Gatekeeper blocking an unsigned app. Clear it once in Terminal:</p>
                <code className="block overflow-x-auto rounded-lg border border-border bg-muted/60 px-3 py-2 font-mono text-[12px] text-foreground">xattr -dr com.apple.quarantine /Applications/Beacon.app</code>
              </div>
              <button
                onClick={() => void startDownload('mac')}
                className="mt-auto flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-6 text-sm font-semibold text-background transition hover:-translate-y-px active:scale-[0.985]"
              >
                <Download className="h-4 w-4" />
                Download DMG
              </button>
            </RevealItem>
          </RevealGroup>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Install, open Beacon, and start testing locally. No Python runtime or hosted Beacon account required.
          </div>
        </div>
      </section>

      <section id="contributors" className="border-t border-border/60 bg-muted/15">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
          <Reveal className="max-w-3xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-500">
              <Users className="h-5 w-5" />
            </div>
            <h2 className="mt-5 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
              Built in the open, improved together.
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
              Code, testing, documentation, design, and careful bug reports all move Beacon forward.
            </p>
          </Reveal>
          <Reveal className="mt-10" delay={0.08}>
            <ContributorWall />
          </Reveal>
          <a
            href="/contributors/"
            className="group mt-8 inline-flex h-12 items-center gap-2 rounded-2xl border border-border bg-card px-6 text-sm font-semibold transition-all hover:-translate-y-px hover:bg-muted active:scale-[0.985]"
          >
            See how to contribute <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </section>

      <section id="support" className="border-t border-border/60">
        <Reveal className="mx-auto max-w-3xl px-5 py-20 text-center lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-1 text-xs font-semibold tracking-widest text-amber-600 dark:text-amber-400">
            <Coffee className="h-3.5 w-3.5" /> SUPPORT THE PROJECT
          </div>
          <h2 className="mt-4 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Beacon is free &amp; open.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Fund the work, improve the code, sharpen the documentation, test a release, or
            help the community find the next good idea.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
            <a
              href="/contributors/"
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-7 text-[15px] font-bold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              <GitBranch className="h-5 w-5" /> Contribute to Beacon
            </a>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-amber-400 px-7 text-[15px] font-bold text-amber-950 shadow-xl transition-all hover:-translate-y-px hover:bg-amber-300 active:scale-[0.985]"
            >
              <Coffee className="h-5 w-5" /> Buy me a coffee
            </a>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl border border-border bg-card/70 px-7 text-[15px] font-semibold transition-all hover:-translate-y-px hover:bg-muted active:scale-[0.985]"
            >
              <MessagesSquare className="h-5 w-5" /> Join the Discord
            </a>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-border/60 bg-background/80">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-y-3 px-5 py-8 text-sm text-muted-foreground md:flex-row md:justify-between lg:px-8">
          <div className="flex items-center gap-2 font-medium text-foreground/90">
            <BrandMark size="sm" animated={false} />
            Beacon
          </div>
          <div className="flex gap-x-6 text-xs">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#workflow" className="hover:text-foreground">How it works</a>
            <a href="#desktop" className="hover:text-foreground">Desktop</a>
            <a href="/contributors/" className="hover:text-foreground">Contributors</a>
            <a href="#support" className="hover:text-foreground">Support</a>
            <a href={DISCORD_URL} target="_blank" rel="noopener" className="hover:text-foreground">Discord</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener" className="hover:text-foreground">GitHub</a>
            <a href={DOCS_URL} target="_blank" rel="noopener" className="hover:text-foreground">Documentation</a>
          </div>
          <div className="text-xs">Built for people who ship APIs.</div>
        </div>
      </footer>
    </main>
  )
}

function FeatureGallery() {
  const signals = [
    ['47', 'ready-to-run sample requests'],
    ['21', 'organized endpoint folders'],
    ['Local', 'projects, history, and credentials'],
    ['Live', 'latency, RPS, and response evidence'],
  ]

  return (
    <section id="product-preview" className="product-story relative scroll-mt-20 overflow-hidden border-y border-border/60">
      <div className="product-story-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
        <Reveal className="grid gap-8 lg:grid-cols-[1fr_0.62fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-cyan-500">Captured from Beacon 0.3.0</p>
            <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.04em] md:text-6xl">
              The complete testing loop, in the open.
            </h2>
          </div>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground lg:pb-1">
            These are the current desktop screens—not concept art. Start with a safe sample workspace, shape the request, run it, and keep the evidence.
          </p>
        </Reveal>

        <RevealGroup className="mt-10 grid border-y border-border/70 sm:grid-cols-2 lg:grid-cols-4" stagger={0.08}>
          {signals.map(([value, label]) => (
            <RevealItem key={label} className="border-b border-border/70 py-5 sm:border-r sm:px-5 lg:border-b-0 first:pl-0 last:border-r-0">
              <div className="font-mono text-lg font-bold text-foreground">
                {/^\d+$/.test(value) ? <CountUp value={Number(value)} /> : value}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{label}</div>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,1.58fr)_minmax(250px,0.42fr)] lg:items-center">
          <ScreenFrame src={workspaceShot} alt="Current Beacon workspace with 47 JSONPlaceholder requests, test controls, and live monitoring" priority />
          <div className="lg:pl-4">
            <div className="h-px w-16 bg-cyan-400" />
            <h3 className="mt-6 text-3xl font-semibold tracking-tight">Arrive with something real to run.</h3>
            <p className="mt-4 leading-7 text-muted-foreground">
              The latest first-run workspace includes 47 safe JSONPlaceholder requests across 21 folders, plus load controls and a live monitor in the same view.
            </p>
            <div className="mt-7 space-y-3 font-mono text-xs text-muted-foreground">
              <div className="flex items-center justify-between border-b border-border/70 pb-3"><span>COLLECTION</span><span className="text-foreground">JSONPlaceholder</span></div>
              <div className="flex items-center justify-between border-b border-border/70 pb-3"><span>MODE</span><span className="text-foreground">Load / scenario</span></div>
              <div className="flex items-center justify-between border-b border-border/70 pb-3"><span>STORAGE</span><span className="text-foreground">Local only</span></div>
            </div>
          </div>
        </Reveal>

        <div className="mt-24">
          <Reveal className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-cyan-500">Request → evidence</p>
              <h3 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Keep setup and proof close together.</h3>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">No route changes, no context switch, no hidden cloud workspace.</p>
          </Reveal>
          <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr] lg:gap-8">
            <FeatureFigure
              src={requestBuilderShot}
              alt="Current Beacon request builder with auth, extractors, dynamic helpers, and assertions"
              eyebrow="Compose"
              title="Build the request precisely"
              body="Set method, auth, payloads, headers, extractors, retry behavior, and assertions in one focused editor."
            />
            <FeatureFigure
              src={responseInspectorShot}
              alt="Current Beacon live monitor showing a completed JSONPlaceholder load run and response body"
              eyebrow="Inspect"
              title="Read the run while it happens"
              body="Track success, RPS, latency, errors, logs, and the complete response body without leaving the workspace."
              focus="right"
            />
          </div>
        </div>

        <Reveal className="mt-24 grid gap-8 rounded-[2rem] border border-cyan-500/20 bg-cyan-500/[0.035] p-5 md:p-8 lg:grid-cols-[0.42fr_1.58fr] lg:items-center lg:p-10">
          <div className="lg:pr-4">
            <History className="h-7 w-7 text-cyan-500" />
            <h3 className="mt-6 text-3xl font-semibold tracking-tight">Runs now leave a trail.</h3>
            <p className="mt-4 leading-7 text-muted-foreground">
              Search, filter, pin, inspect, export, and compare saved runs. History is stored locally in SQLite and recovers interrupted work after a restart.
            </p>
          </div>
          <ScreenFrame src={runHistoryShot} alt="Beacon Run History showing a completed load run with searchable filters and comparison controls" />
        </Reveal>

        <div className="mt-24 grid gap-6 md:grid-cols-[0.92fr_1.08fr] md:gap-8">
          <FeatureFigure
            src={assertionsShot}
            alt="Current Beacon endpoint editor showing status, timing, header, and JSON field assertions"
            eyebrow="Validate"
            title="Make success explicit"
            body="Check status, response time, headers, body content, and JSON fields on every send or load run."
            focus="right"
          />
          <FeatureFigure
            src={environmentsShot}
            alt="Current Beacon environment manager with JSONPlaceholder base URL and reusable variables"
            eyebrow="Isolate"
            title="Change environments, not endpoints"
            body="Keep base URLs and reusable variables together, then switch the active context from the sidebar."
          />
        </div>

        <Reveal className="mt-24 grid gap-8 lg:grid-cols-[1.58fr_0.42fr] lg:items-center">
          <ScreenFrame src={scenarioResultsShot} alt="Current Beacon run results with live metrics, responses, and logs" />
          <div className="lg:pl-4">
            <GitBranch className="h-7 w-7 text-cyan-500" />
            <h3 className="mt-6 text-3xl font-semibold tracking-tight">Chain it, then scale it.</h3>
            <p className="mt-4 leading-7 text-muted-foreground">
              Run dependent endpoints in sequence, refresh extracted tokens between steps, or move into load mode with fixed concurrency and rate controls.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

interface FeatureFigureProps {
  src: string
  alt: string
  eyebrow: string
  title: string
  body: string
  focus?: 'right'
}

function FeatureFigure({ src, alt, eyebrow, title, body, focus }: FeatureFigureProps) {
  return (
    <figure className="group min-w-0 border-t border-border/80 pt-4">
      <figcaption className="mb-5 grid gap-2 sm:grid-cols-[0.28fr_0.72fr]">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-500">{eyebrow}</div>
        <div>
        <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p>
        </div>
      </figcaption>
      <ScreenFrame src={src} alt={alt} focus={focus} />
    </figure>
  )
}

interface ScreenFrameProps {
  src: string
  alt: string
  priority?: boolean
  focus?: 'right'
}

function ScreenFrame({ src, alt, priority = false, focus }: ScreenFrameProps) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className="screen-frame group relative min-w-0 overflow-hidden rounded-[1.35rem] border border-border/80 bg-card"
      initial={reduce ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex h-9 items-center gap-1.5 border-b border-border/70 bg-muted/35 px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Beacon desktop</span>
      </div>
      <div className={focus === 'right' ? 'aspect-[4/3] overflow-hidden' : ''}>
        <img
          src={src}
          alt={alt}
          width="1440"
          height="1000"
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className={`block transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.008] ${
            focus === 'right' ? 'h-full w-[155%] max-w-none object-cover object-right' : 'h-auto w-full'
          }`}
        />
      </div>
    </motion.div>
  )
}

interface ProductPreviewProps {
  current: typeof REQUESTS[number]
  selected: number
  response: string
  logs: string[]
  running: boolean
  logRef: RefObject<HTMLDivElement>
  onSelect: (index: number) => void
  onRun: () => void
  onReset: () => void
}

function ProductPreview({ current, selected, response, logs, running, logRef, onSelect, onRun, onReset }: ProductPreviewProps) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      id="interactive-demo"
      className="relative min-w-0 scroll-mt-24"
      initial={reduce ? undefined : { opacity: 0, y: 26, scale: 0.97 }}
      animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
    >
      <div className="absolute -inset-4 -z-10 rounded-[2rem] border border-cyan-500/10 bg-cyan-500/5 blur-2xl" />
      <div className="w-full min-w-0 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
            </div>
            <span className="font-mono text-xs font-medium tracking-widest text-muted-foreground">BEACON • RETAIL API</span>
          </div>
          <div className="hidden items-center gap-1.5 rounded-full border border-border bg-background px-3 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> CONNECTED
          </div>
        </div>

        <div className="grid min-h-[560px] min-w-0 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-border bg-muted/25 p-3 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-[11px] font-bold uppercase text-muted-foreground">Collection</span>
              <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
            </div>
            <div className="space-y-1">
              {REQUESTS.map((req, index) => (
                <button
                  key={`${req.method}-${req.path}`}
                  onClick={() => onSelect(index)}
                  className={`w-full rounded-lg px-2.5 py-2 text-left transition-all ${
                    selected === index ? 'bg-foreground text-background shadow-sm' : 'hover:bg-background'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-[11px] font-bold ${selected === index ? 'text-cyan-300' : 'text-cyan-600 dark:text-cyan-400'}`}>{req.method}</span>
                    <span className="font-mono text-[10px] tabular-nums opacity-70">{req.time}ms</span>
                  </div>
                  <div className="mt-1 truncate text-xs font-semibold">{req.path}</div>
                </button>
              ))}
            </div>
          </aside>

          <div className="grid min-w-0 lg:grid-rows-[auto_1fr_auto]">
            <div className="border-b border-border p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
                  <span className="border-r border-border px-3 py-2 font-mono text-xs font-bold text-cyan-600 dark:text-cyan-400">{current.method}</span>
                  <span className="truncate px-3 py-2 font-mono text-xs text-muted-foreground">https://api.beacon.local{current.path}</span>
                </div>
                <button
                  onClick={onRun}
                  className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-xs font-bold transition-all active:scale-[0.98] ${
                    running ? 'bg-destructive text-destructive-foreground' : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                  }`}
                >
                  {running ? <StopCircle className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {running ? 'Stop' : 'Run'}
                </button>
                <button onClick={onReset} className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-xs font-bold hover:bg-muted">
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid min-w-0 lg:grid-cols-2">
              <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  <Code2 className="h-3.5 w-3.5" /> Request body
                </div>
                <pre className="min-h-[230px] overflow-auto rounded-xl bg-slate-950 p-4 text-left font-mono text-xs leading-6 text-slate-200"><code>{SAMPLE_BODY}</code></pre>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    ['Auth', 'Bearer'],
                    ['Env', 'Local'],
                    ['Delay', '0.1s'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border bg-background p-3">
                      <div className="text-[10px] font-semibold text-muted-foreground">{label}</div>
                      <div className="mt-1 truncate font-mono text-xs font-bold">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4">
                <div className="mb-2 flex items-center justify-between text-xs font-bold text-muted-foreground">
                  <span className="inline-flex items-center gap-2"><Terminal className="h-3.5 w-3.5" /> Response</span>
                  <span className="flex items-center gap-1.5">
                    <span className={`rounded-md px-2 py-0.5 font-mono ${current.status >= 200 && current.status < 300 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>{current.status}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{current.time}ms</span>
                    <span className={`rounded-md px-2 py-0.5 ${current.status >= 200 && current.status < 300 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                      {current.status >= 200 && current.status < 300 ? '✓ assertions' : '✗ assertions'}
                    </span>
                  </span>
                </div>
                <pre className="min-h-[230px] overflow-auto rounded-xl bg-slate-950 p-4 text-left font-mono text-xs leading-6 text-slate-200"><code>{response}</code></pre>
                <div ref={logRef} className="mt-4 h-24 overflow-auto rounded-xl border border-border bg-background p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                  {logs.map((line, index) => (
                    <div key={`${line}-${index}`} className={line.includes('429') ? 'text-amber-600 dark:text-amber-400' : line.includes('complete') ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid border-t border-border bg-muted/25 sm:grid-cols-4">
              {[
                ['Attempts', REQUESTS.length],
                ['Success', REQUESTS.filter((r) => r.status < 300).length],
                ['Rate limited', REQUESTS.filter((r) => r.status === 429).length],
                ['Avg latency', '68ms'],
              ].map(([label, value]) => (
                <div key={label} className="border-b border-border px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                  <div className="font-mono text-lg font-bold tabular-nums">{value}</div>
                  <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
