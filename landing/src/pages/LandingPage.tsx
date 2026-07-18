import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Activity,
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
  Play,
  Repeat,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Terminal,
  X,
} from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { BrandMark } from '../components/BrandMark'
import { NetworkBackground } from '../components/NetworkBackground'
import featureBanner from '../assets/beacon-feature-banner.webp'

// URLs injected from the root .env via vite.config.ts (define block).
const DOCS_URL = (import.meta as any).env?.VITE_DOCS_URL || 'http://localhost:5174/docs/'
const DOWNLOAD_URL =
  (import.meta as any).env?.VITE_DOWNLOAD_URL || 'https://github.com/nannndev/beacon/releases/latest'
const SUPPORT_URL =
  (import.meta as any).env?.VITE_SUPPORT_URL || 'https://buymeacoffee.com/ekaprasety8'
const GITHUB_URL =
  (import.meta as any).env?.VITE_GITHUB_URL || 'https://github.com/nannndev/beacon'
// TODO: create a Discord server + permanent invite, then set VITE_DISCORD_URL
// (or replace this default) with the real invite link.
const DISCORD_URL =
  (import.meta as any).env?.VITE_DISCORD_URL || 'https://discord.gg/'

const NAV_LINKS = [
  { id: 'product-preview', label: 'Product' },
  { id: 'features', label: 'Features' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'mcp', label: 'AI' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'support', label: 'Support' },
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
  const download = () => {
    window.location.href = DOWNLOAD_URL
  }
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('product-preview')
  const [logs, setLogs] = useState<string[]>([
    'Ready. Select a request or run the collection.',
    'Environment: Local / api.beacon.local',
  ])
  const logRef = useRef<HTMLDivElement>(null)

  const current = REQUESTS[selected]
  const successCount = REQUESTS.filter((r) => r.status >= 200 && r.status < 300).length
  const avgTime = Math.round(REQUESTS.reduce((sum, r) => sum + r.time, 0) / REQUESTS.length)

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
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
      <header
        className={`sticky top-0 z-50 border-b transition-all duration-300 ${
          scrolled
            ? 'border-border/70 bg-background/85 backdrop-blur-2xl shadow-sm'
            : 'border-transparent bg-background/40 backdrop-blur-md'
        }`}
      >
        <div
          className={`mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 transition-all duration-300 lg:px-8 ${
            scrolled ? 'h-14' : 'h-16'
          }`}
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
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  activeSection === link.id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {link.label}
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
                  Download for Windows
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

        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-1 text-xs font-semibold tracking-widest text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            FOR API TEAMS &amp; SECURITY RESEARCHERS
          </div>

          <h1 className="text-balance text-6xl font-semibold leading-none tracking-[-3.5px] md:text-[84px] md:tracking-[-4.5px]">
            Clarity for<br /> every API call.
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground">
            Send a request and read the response. Assert it, chain it, and load-test it —
            collections, environments, and dynamic variables included. Built for speed and precision.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={download}
              className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-7 text-[15px] font-semibold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              Download for Windows
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            <a
              href="#desktop"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-6 text-[15px] font-semibold transition-all hover:bg-muted hover:border-border active:scale-[0.985]"
            >
              <Download className="h-4 w-4" />
              Download Desktop
            </a>
          </div>

          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[
              { label: 'Requests', value: '128k' },
              { label: 'Avg run', value: `${avgTime}ms` },
              { label: 'Passed', value: `${successCount}/${REQUESTS.length}` },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-card/70 px-3 py-3">
                <div className="font-mono text-xl font-bold tabular-nums">{item.value}</div>
                <div className="mt-1 text-[11px] font-semibold text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

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
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-16 lg:grid-cols-4 lg:px-8">
          {[
            { icon: FolderKanban, title: 'Collections', body: 'Keep endpoints grouped by product area, environment, or release.' },
            { icon: Globe2, title: 'Environments', body: 'Switch base URLs and variables without editing every request.' },
            { icon: Braces, title: 'Templating', body: 'Use dynamic values like random email, UUID, timestamp, and tokens.' },
            { icon: History, title: 'Run history', body: 'Inspect response bodies, timing, status, and logs from every run.' },
          ].map(({ icon: Icon, title, body }) => (
            <article key={title} className="group rounded-2xl border border-border/70 bg-background/90 p-6 transition-all hover:-translate-y-0.5 hover:border-cyan-500/30 hover:shadow-xl">
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight group-hover:text-cyan-400 transition-colors">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="feature-overview-title" className="relative overflow-hidden border-b border-border/60 bg-slate-950 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(34,211,238,0.12),transparent_46%)]" />
        <div className="relative mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div className="max-w-3xl">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-cyan-400">The whole request lifecycle</p>
              <h2 id="feature-overview-title" className="mt-3 text-balance text-3xl font-semibold tracking-tight md:text-5xl">
                Build, validate, chain, and measure from one workspace.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-slate-400 md:text-right">
              A modular workspace that grows with your API testing workflow—from a single response to sustained load.
            </p>
          </div>

          <figure className="group relative overflow-hidden rounded-2xl border border-cyan-300/15 bg-slate-900 shadow-[0_30px_100px_-40px_rgba(34,211,238,0.45)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
            <img
              src={featureBanner}
              alt="Beacon workspace showing request flows, environments, response assertions, and latency monitoring"
              width="1672"
              height="941"
              loading="lazy"
              decoding="async"
              className="block h-auto w-full transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.012]"
            />
          </figure>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div>
            <p className="text-sm font-bold text-cyan-500">Built for API work</p>
            <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight md:text-5xl">
              A focused workspace that keeps request work visible.
            </h2>
            <p className="mt-5 max-w-lg text-pretty leading-7 text-muted-foreground">
              Beacon stays close to the work: URL, method, auth, payload, response, run config, logs, and the variables that connect them.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { icon: Send, title: 'Send & inspect', body: 'Fire one request and read the full response — status, timing, headers, and a pretty JSON / XML / HTML viewer.' },
              { icon: ShieldCheck, title: 'Assertions', body: 'Pass/fail rules on status, response time, body text, JSON fields, or headers — checked on every send.' },
              { icon: GitBranch, title: 'Scenarios', body: 'Chain endpoints in order; tokens extracted from one step flow into the next. Login → use → repeat.' },
              { icon: FileCode2, title: 'Any content type', body: 'JSON, form, multipart file upload, or raw text / XML / GraphQL — all with variable templating.' },
              { icon: Activity, title: 'Live load testing', body: 'Watch attempts, success, rate limits, errors, latency percentiles, and a live trend chart as runs execute.' },
              { icon: Repeat, title: 'Retry & rate control', body: 'Auto-retry on errors or non-2xx, and tune concurrency, delays, and max requests per endpoint.' },
            ].map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-xl border border-border bg-card/55 p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500/10 to-teal-500/10 text-cyan-400 transition group-hover:scale-105">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="font-semibold tracking-tight">{title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto max-w-7xl px-5 pb-20 lg:px-8">
        <div className="rounded-3xl border border-border bg-card/50 p-8 md:p-10">
          <div className="flex flex-col justify-between gap-6 border-b border-border pb-8 md:flex-row md:items-end">
            <div>
              <div className="text-sm font-semibold tracking-widest text-cyan-400">WORKFLOW</div>
              <h2 className="mt-2 text-4xl font-semibold tracking-tight">From idea to production-grade testing.</h2>
            </div>
            <button
              onClick={download}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-6 text-sm font-semibold transition-all hover:bg-muted"
            >
              Download <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 pt-8 md:grid-cols-4">
            {[
              ['01', 'Create', 'Method, URL, headers, body, auth, and dynamic variables.'],
              ['02', 'Send & inspect', 'Fire once, read the response, click a field to save a token.'],
              ['03', 'Assert', 'Add pass/fail rules on status, time, body, or JSON.'],
              ['04', 'Chain & scale', 'Run a scenario end-to-end, or load-test at concurrency.'],
            ].map(([step, title, body]) => (
              <div key={step} className="rounded-2xl border border-border/50 bg-background/60 p-6">
                <div className="font-mono text-xs font-bold tracking-widest text-cyan-500">{step}</div>
                <div className="mt-4 text-xl font-semibold tracking-tight">{title}</div>
                <p className="mt-2 text-[15px] leading-snug text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="mcp" className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-1 text-xs font-semibold tracking-widest text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-cyan-400" /> MCP · AI INTEGRATION
            </div>
            <h2 className="mt-4 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
              Drive Beacon with your AI.
            </h2>
            <p className="mt-5 max-w-lg text-pretty leading-7 text-muted-foreground">
              Beacon ships a bundled MCP server — one click in the desktop app registers it
              with Claude. Assistants get <span className="font-semibold text-foreground">17 tools</span> to
              create, organize, import, send &amp; inspect, assert, chain scenarios, and
              load-test endpoints — through the same engine, no glue code.
            </p>
            <a
              href={DOCS_URL.replace(/\/$/, '') + '/mcp'}
              target="_blank"
              rel="noopener"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cyan-500 transition-colors hover:text-cyan-400"
            >
              Read the MCP guide <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div className="rounded-2xl border border-border bg-slate-950 p-5 font-mono text-xs leading-6 text-slate-200 shadow-xl">
            <div className="mb-3 flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
            </div>
            <pre className="overflow-auto"><code>{`# Desktop app → MCP panel → one click to register
# (or Claude Code, pointing at the bundled binary)
claude mcp add beacon -- <path-to>/mcp_server

# then just ask your assistant:
"send Login, then run the Checkout scenario"
"load-test /reports 100x at concurrency 10"`}</code></pre>
          </div>
        </div>
      </section>

      <section id="desktop" className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1 text-xs font-medium tracking-widest text-muted-foreground ring-1 ring-border">
              NATIVE DESKTOP APP (TAURI)
            </div>
            <h2 className="mt-4 text-balance text-5xl font-semibold tracking-tighter">
              Take Beacon offline.<br /> Run it anywhere.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              The same beautiful interface, now as a native desktop application. Full filesystem access, local network testing, and system integrations.
            </p>
          </div>

          <div className="mx-auto mt-12 max-w-3xl rounded-3xl border border-border/70 bg-card/90 p-7 transition-all hover:border-cyan-500/30 hover:shadow-2xl md:p-9">
            <div className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-5">
                <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-cyan-500/10 text-3xl">🖥️</span>
                <div>
                  <div className="text-2xl font-semibold tracking-tight">Beacon for Windows</div>
                  <div className="mt-1 text-sm text-muted-foreground">Windows 10/11 · x64 · Current-user installer</div>
                  <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> backend + MCP included
                  </div>
                </div>
              </div>

              <a
                href={DOWNLOAD_URL}
                target="_blank"
                rel="noopener"
                className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-foreground px-6 text-sm font-semibold text-background transition hover:-translate-y-px hover:bg-zinc-800 active:scale-[0.985]"
              >
                <Download className="h-4 w-4" />
                Latest release
              </a>
            </div>
          </div>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Install, open Beacon, and start testing locally. No Python runtime or hosted Beacon account required.
          </div>
        </div>
      </section>

      <section id="support" className="border-t border-border/60">
        <div className="mx-auto max-w-3xl px-5 py-20 text-center lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-1 text-xs font-semibold tracking-widest text-amber-600 dark:text-amber-400">
            <Coffee className="h-3.5 w-3.5" /> SUPPORT THE PROJECT
          </div>
          <h2 className="mt-4 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Beacon is free &amp; open.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Buy me a coffee to keep it moving, or join the community on Discord — ideas,
            questions, and contributions welcome.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
        </div>
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
  return (
    <div id="product-preview" className="relative min-w-0 scroll-mt-24">
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
    </div>
  )
}
