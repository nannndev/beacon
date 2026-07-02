import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Activity,
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Download,
  FileJson,
  FolderKanban,
  Globe2,
  History,
  Layers3,
  Play,
  RotateCcw,
  Server,
  Sparkles,
  StopCircle,
  Terminal,
  Workflow,
} from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { BrandMark } from '../components/BrandMark'

interface Props {
  onLaunchApp: () => void
}

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

export default function LandingPage({ onLaunchApp }: Props) {
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState(0)
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
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
          <a href="#" className="flex items-center gap-2.5" aria-label="Beacon home">
            <BrandMark size="md" />
            <span className="text-lg font-extrabold tracking-tight">Beacon</span>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <a href="#product-preview" className="transition hover:text-foreground">Product</a>
            <a href="#features" className="transition hover:text-foreground">Features</a>
            <a href="#workflow" className="transition hover:text-foreground">Workflow</a>
            <a href="#desktop" className="transition hover:text-foreground">Desktop</a>
            <a 
              href="http://localhost:5174" 
              target="_blank" 
              rel="noopener" 
              className="transition font-semibold text-cyan-400 hover:text-cyan-300"
              title="Open full documentation (VitePress)"
            >
              Documentation
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />

            <a
              href="#desktop"
              className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-4 py-1.5 text-sm font-semibold transition-all hover:bg-muted hover:border-border active:scale-[0.985]"
            >
              <Download className="h-4 w-4" />
              Download Desktop
            </a>
            <a
              href="/docs"
              target="_blank"
              rel="noopener"
              className="hidden md:inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-4 py-1.5 text-sm font-semibold transition-all hover:bg-muted hover:border-border active:scale-[0.985]"
            >
              Documentation
            </a>

            <a
              href="/docs"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 px-4 py-1.5 text-sm font-semibold text-cyan-400 transition-all hover:bg-cyan-500/5 active:scale-[0.985]"
            >
              Documentation
            </a>

            <button
              onClick={onLaunchApp}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-bold text-background shadow-sm transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              Launch in browser
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
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
            A modern workspace for API collections, environments, dynamic requests, and high-fidelity load testing. Built for speed and precision.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={onLaunchApp}
              className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-7 text-[15px] font-semibold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              Open in browser
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            <a
              href="#desktop"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-6 text-[15px] font-semibold transition-all hover:bg-muted hover:border-border active:scale-[0.985]"
            >
              <Download className="h-4 w-4" />
              Download Desktop
            </a>

            <a
              href="http://localhost:5174"
              target="_blank"
              rel="noopener"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 px-6 text-[15px] font-semibold text-cyan-400 transition-all hover:bg-cyan-500/5 active:scale-[0.985]"
            >
              Documentation
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
              { icon: Code2, title: 'Body editor', body: 'Edit JSON, form data, or multipart payloads with variable support.' },
              { icon: Activity, title: 'Live execution', body: 'Watch attempts, success, rate limits, errors, and timing update as runs execute.' },
              { icon: Workflow, title: 'Chained auth', body: 'Extract tokens from responses and reuse them in later requests.' },
              { icon: FileJson, title: 'Portable projects', body: 'Import and export project JSON without locking your workflow to a database.' },
              { icon: Server, title: 'Backend runner', body: 'Run concurrent tests through the FastAPI execution layer.' },
              { icon: Clock3, title: 'Rate control', body: 'Tune concurrency, delays, and max requests per endpoint.' },
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
              onClick={onLaunchApp}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-6 text-sm font-semibold transition-all hover:bg-muted"
            >
              Try it now <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 pt-8 md:grid-cols-4">
            {[
              ['01', 'Create', 'Define method, URL, headers, body, and auth.'],
              ['02', 'Parameterize', 'Use variables and dynamic generators.'],
              ['03', 'Run', 'Execute one endpoint or a full collection.'],
              ['04', 'Inspect', 'Read response, logs, stats, and failures.'],
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

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { platform: 'Windows', version: 'x64', size: '48 MB', icon: '🖥️' },
              { platform: 'macOS', version: 'Universal', size: '51 MB', icon: '' },
              { platform: 'Linux', version: 'AppImage', size: '47 MB', icon: '🐧' },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-3xl border border-border/70 bg-card/90 p-7 transition-all hover:border-cyan-500/30 hover:shadow-2xl"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-4xl">{item.icon}</span>
                    <div className="mt-6 text-2xl font-semibold tracking-tight">{item.platform}</div>
                    <div className="text-sm text-muted-foreground">{item.version}</div>
                  </div>
                  <div className="rounded-xl bg-muted px-3 py-1 font-mono text-xs text-muted-foreground">{item.size}</div>
                </div>

                <button
                  onClick={() => {
                    window.alert(
                      `To build the desktop EXE (includes UI + backend):\n\n1. Install Rust: https://rustup.rs/\n2. cd frontend\n3. npm run desktop:build\n\nThe final executable will be in frontend/src-tauri/target/release/\n\nIt will auto-start the local backend when launched.`
                    );
                  }}
                  className="mt-10 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background active:scale-[0.985] hover:bg-zinc-800 transition"
                >
                  <Download className="h-4 w-4" />
                  Build Desktop for {item.platform}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center text-sm text-muted-foreground">
            From <code>frontend</code>: <code>npm run desktop:build</code> produces a single .exe (UI + backend). Double-click it — everything starts automatically.
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
            <a href="http://localhost:5174" target="_blank" rel="noopener" className="hover:text-foreground">Documentation</a>
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
                  <span className={`rounded-md px-2 py-0.5 font-mono ${current.status === 429 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>{current.status}</span>
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
