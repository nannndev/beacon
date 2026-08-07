import { ArrowRight, Braces, FolderKanban, Globe2, History, Send, ShieldCheck, Activity, Terminal, Zap } from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { ThemeToggle } from '../components/ThemeToggle'

interface Props {
  onGetStarted: () => void
}

const STATS = [
  { value: '47', label: 'Sample endpoints' },
  { value: '36', label: 'Dynamic generators' },
  { value: '9', label: 'Traffic modes' },
  { value: '3', label: 'Target types' },
]

const STEPS = [
  {
    icon: Send,
    title: 'Build & send',
    body: 'Pick method, URL, auth, headers, and payload — then fire one request and inspect the response.',
    color: 'cyan',
  },
  {
    icon: ShieldCheck,
    title: 'Add assertions',
    body: 'Turn status, latency, headers, body text, and JSON paths into pass/fail checks.',
    color: 'emerald',
  },
  {
    icon: Activity,
    title: 'Run load tests',
    body: 'Load, spike, soak, fuzz, rate probe, WebSocket — pick a mode, tune the knobs, and watch live.',
    color: 'violet',
  },
  {
    icon: FolderKanban,
    title: 'Chain scenarios',
    body: 'Login, extract a token, call protected endpoints — virtual users carry state across the journey.',
    color: 'amber',
  },
]

const HIGHLIGHTS = [
  { icon: Globe2, text: 'Environments: local, staging, production — one click to switch targets.' },
  { icon: Braces, text: 'Templating: random_email, uuid, timestamp, chained tokens — fresh every request.' },
  { icon: Terminal, text: 'CLI & MCP: run headless or let your AI agent drive the same project.' },
  { icon: History, text: 'Run history: every result saved with charts, latency distribution, and replay.' },
]

export default function Onboarding({ onGetStarted }: Props) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-5 py-8 text-foreground">
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,hsl(var(--beacon-500)/0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_50%_at_80%_90%,hsl(200_100%_60%/0.06),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(#8888_0.6px,transparent_1px)] bg-[length:20px_20px] opacity-[0.06]" />
      </div>

      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-3xl animate-fade-in">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="animate-float">
            <BrandMark size="lg" animated />
          </div>
          <h1 className="mt-5 text-balance bg-gradient-to-b from-foreground via-foreground to-foreground/70 bg-clip-text text-4xl font-bold tracking-tight text-transparent md:text-5xl">
            Welcome to Beacon
          </h1>
          <p className="mt-3 max-w-lg text-pretty text-[15px] leading-relaxed text-muted-foreground">
            Your API workspace, on your machine. Send, inspect, assert, and load-test
            without an account or cloud sync.
          </p>
        </div>

        {/* Stats bar */}
        <div className="mt-8 grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/40">
          {STATS.map((stat) => (
            <div key={stat.label} className="bg-card/80 px-3 py-3 text-center backdrop-blur-sm">
              <div className="font-mono text-lg font-bold text-cyan-500">{stat.value}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Step cards */}
        <div className="mt-9 grid gap-3 sm:grid-cols-2">
          {STEPS.map(({ icon: Icon, title, body, color }, i) => (
            <div
              key={title}
              className="group rounded-2xl border border-border/70 bg-card/60 p-5 transition-colors hover:border-cyan-500/20 hover:bg-card/80"
              style={{ animationDelay: `${0.1 + i * 0.06}s` }}
            >
              <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl text-${color}-500 bg-${color}-500/10`}>
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        {/* Highlight bullets */}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {HIGHLIGHTS.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-2.5 rounded-xl border border-border/40 bg-muted/20 px-3.5 py-2.5">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-[12px] leading-relaxed text-muted-foreground">{text}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-9 flex flex-col items-center gap-4">
          <button
            onClick={onGetStarted}
            className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-8 text-[15px] font-semibold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
          >
            <Zap className="h-4 w-4 text-cyan-400" />
            Get started
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>

          <p className="text-center text-[11px] text-muted-foreground">
            Beacon is free &amp; open —{' '}
            <a
              href="https://buymeacoffee.com/ekaprasety8"
              target="_blank"
              rel="noopener"
              className="font-medium text-amber-500 hover:underline"
            >
              buy me a coffee ☕
            </a>
            {' '}· Press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd> to search anywhere
          </p>
        </div>
      </div>
    </div>
  )
}
