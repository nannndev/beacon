import { useEffect, useState } from 'react'
import {
  Activity,
  Apple,
  ArrowRight,
  Bot,
  Braces,
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
  Repeat,
  Send,
  ShieldCheck,
  Terminal,
  Users,
  UserCheck,
  Wifi,
  X,
} from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { BrandMark } from '../components/BrandMark'
import { NetworkBackground } from '../components/NetworkBackground'
import { ContributorWall } from '../components/ContributorWall'
import { startDownload } from '../lib/download'
import {
  CountUp,
  Reveal,
  RevealGroup,
  RevealItem,
  motion,
  useReducedMotion,
} from '../components/motion'
import workspaceShot from '../assets/features/workspace-v044.png'
import requestBuilderShot from '../assets/features/request-builder.png'
import responseInspectorShot from '../assets/features/response-inspector.png'
import assertionsShot from '../assets/features/assertions.png'
import environmentsShot from '../assets/features/environments.png'
import scenarioResultsShot from '../assets/features/load-soak-v044.png'
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
  { id: 'sharing', label: 'Team' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'mcp', label: 'AI' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'contributors', label: 'Contributors' },
]

export default function LandingPage() {
  // Direct-download the right installer for the visitor's OS (falls back to the
  // releases page). See lib/download.ts.
  const download = () => { void startDownload() }
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('product-preview')

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

  return (
    <main className="landing-shell min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-background text-foreground selection:bg-cyan-500/30">
      <div className="landing-atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
      </div>
      <NetworkBackground />
      <header className="liquid-nav sticky top-0 z-50 border-b">
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
                  Get Beacon
                  <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href="#desktop"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-5 text-sm font-semibold transition-all hover:bg-muted active:scale-[0.985]"
                >
                  <Download className="h-4 w-4" />
                  See desktop app
                </a>
              </div>
            </nav>
          </div>
        )}
      </header>

      <section className="relative mx-auto grid w-full max-w-7xl items-center gap-x-12 gap-y-8 px-5 pb-14 pt-12 lg:px-8 lg:pb-20 lg:pt-20 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="hero-atmosphere absolute inset-0 -z-10" aria-hidden="true" />

        <RevealGroup className="max-w-2xl" stagger={0.08} delayChildren={0.05}>
          <RevealItem className="mb-6 inline-flex items-center rounded-full border border-border/60 bg-card/60 px-4 py-1 text-xs font-semibold tracking-widest text-muted-foreground">
            FOR PEOPLE WHO BUILD AND BREAK APIs
          </RevealItem>

          <RevealItem as="div">
            <h1 className="text-balance text-6xl font-semibold leading-[0.98] tracking-[-3.5px] md:text-[68px] md:tracking-[-4px]">
              API work,<br /> minus the mess.
            </h1>
          </RevealItem>

          <RevealItem
            as="div"
            className="mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground"
          >
            Send requests, reuse tokens, test behavior, share projects, and run load tests without sending your data to the cloud.
          </RevealItem>

          <RevealItem className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={download}
              className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-7 text-[15px] font-semibold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              Get Beacon
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            <a
              href="#desktop"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-6 text-[15px] font-semibold transition-all hover:bg-muted hover:border-border active:scale-[0.985]"
            >
              <Download className="h-4 w-4" />
              See desktop app
            </a>
          </RevealItem>

        </RevealGroup>

        <HeroProductCapture />
      </section>

      <section id="workspace" className="border-y border-border/60 bg-muted/15">
        <RevealGroup className="mx-auto grid max-w-7xl gap-6 px-5 py-16 lg:grid-cols-4 lg:px-8">
          {[
            { icon: FolderKanban, title: 'Collections', body: 'Keep endpoints grouped by product area, environment, or release.' },
            { icon: Globe2, title: 'Environments', body: 'Switch base URLs and variables without editing every request.' },
            { icon: Braces, title: 'Templating', body: 'Use dynamic values like random email, UUID, timestamp, and tokens.' },
            { icon: History, title: 'Run history', body: 'Inspect response bodies, timing, status, and logs from every run.' },
          ].map(({ icon: Icon, title, body }) => (
            <RevealItem key={title} as="article" className="liquid-glass liquid-glass-interactive group rounded-2xl p-6">
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
              { icon: Users, title: 'Secure local sharing', body: 'Pair nearby devices over HTTPS, sync revisioned project source, and keep execution plus private values local.' },
            ].map(({ icon: Icon, title, body }) => (
              <RevealItem key={title} as="article" className="liquid-glass liquid-glass-interactive group rounded-2xl p-5">
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

      <section id="sharing" className="relative scroll-mt-20 overflow-hidden border-y border-border/60 bg-muted/15">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(6,182,212,0.10),transparent_34%),radial-gradient(circle_at_80%_70%,rgba(59,130,246,0.08),transparent_36%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:px-8 lg:py-24">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-4 py-1 text-xs font-semibold tracking-widest text-cyan-600 dark:text-cyan-400">
              <Wifi className="h-3.5 w-3.5" /> LOCAL-FIRST TEAMWORK
            </div>
            <h2 className="mt-5 text-balance text-4xl font-semibold tracking-tight md:text-5xl">Share the project. Run on your own device.</h2>
            <p className="mt-5 max-w-xl leading-7 text-muted-foreground">
              Host one project on your trusted local network, approve each device as Viewer or Editor, and keep endpoint source synchronized without creating a cloud workspace.
            </p>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {[
                [UserCheck, 'Trusted devices', 'Pairing codes, owner approval, roles, and automatic trusted reconnect.'],
                [ShieldCheck, 'Pinned HTTPS', 'Beacon blocks synchronization if the host certificate fingerprint changes.'],
                [GitBranch, 'Conflict-safe revisions', 'Three-way merge preserves unrelated edits and exposes field conflicts.'],
                [PanelsTopLeft, 'Local execution', 'Requests, responses, history, and private values stay on each device.'],
              ].map(([Icon, title, body]) => {
                const SharingIcon = Icon as typeof Users
                return <div key={title as string} className="rounded-2xl border border-border/70 bg-background/65 p-4 backdrop-blur-xl">
                  <SharingIcon className="h-4 w-4 text-cyan-500" />
                  <div className="mt-3 text-sm font-semibold">{title as string}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{body as string}</p>
                </div>
              })}
            </div>
          </Reveal>

          <Reveal delay={0.1} className="liquid-glass rounded-[2rem] p-5 md:p-7">
            <div className="flex items-center justify-between border-b border-border/70 pb-4">
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-500">Local project sharing</div>
                <div className="mt-1 text-lg font-semibold">Platform API source</div>
              </div>
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 font-mono text-[10px] font-bold text-emerald-500">CONNECTED / r24</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ['Host', 'Nando MacBook'],
                ['Transport', 'HTTPS pinned'],
                ['Execution', 'Per device'],
              ].map(([label, value]) => <div key={label} className="rounded-xl border border-border/60 bg-background/55 p-3">
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="mt-2 truncate text-xs font-semibold">{value}</div>
              </div>)}
            </div>
            <div className="mt-5 space-y-2">
              {[
                ['QA Windows', 'EDITOR', 'editing Auth API'],
                ['Frontend Linux', 'VIEWER', 'viewing Orders'],
              ].map(([device, role, state]) => <div key={device} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/55 px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{device}</span>
                <span className="font-mono text-[9px] text-muted-foreground">{state}</span>
                <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 font-mono text-[9px] font-bold text-cyan-500">{role}</span>
              </div>)}
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-border/70 pt-4 text-xs text-muted-foreground">
              <span>LAN discovery and trusted reconnect are active</span>
              <span className="font-mono text-cyan-500">SOURCE ONLY</span>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="workflow" className="mx-auto max-w-7xl px-5 pb-20 lg:px-8">
        <Reveal className="liquid-glass rounded-3xl p-8 md:p-10">
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

          <RevealGroup className="mx-auto mt-12 grid max-w-7xl gap-5 md:grid-cols-3" stagger={0.1}>
            <RevealItem as="article" className="liquid-glass liquid-glass-interactive group flex min-h-72 flex-col rounded-3xl p-7 md:p-9">
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

            <RevealItem as="article" className="liquid-glass liquid-glass-interactive group flex min-h-72 flex-col rounded-3xl p-7 md:p-9">
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
                <p>First launch: Beacon isn't notarized yet, so macOS may say it's "damaged". It isn't. Gatekeeper is blocking an unsigned app. Clear it once in Terminal:</p>
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

            <RevealItem as="article" className="liquid-glass liquid-glass-interactive group flex min-h-72 flex-col rounded-3xl p-7 md:p-9">
              <div className="flex items-center gap-5">
                <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                  <Terminal className="h-8 w-8 text-emerald-500" strokeWidth={1.8} />
                </span>
                <div>
                  <div className="text-2xl font-semibold tracking-tight">Beacon for Linux</div>
                  <div className="mt-1 text-sm text-muted-foreground">Linux x64, AppImage &amp; DEB</div>
                </div>
              </div>
              <div className="mt-6 text-sm leading-6 text-muted-foreground">
                Portable AppImage for most distributions. A native DEB package is also available for Debian and Ubuntu.
              </div>
              <button
                onClick={() => void startDownload('linux')}
                className="mt-auto flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-6 text-sm font-semibold text-background transition hover:-translate-y-px active:scale-[0.985]"
              >
                <Download className="h-4 w-4" />
                Download AppImage
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
    ['Send', 'directly from an endpoint row'],
    ['Capture', 'response fields into variables'],
    ['Assert', 'status, timing, headers, and JSON'],
    ['Local', 'projects, history, and credentials'],
  ]

  return (
    <section id="product-preview" className="product-story relative scroll-mt-20 overflow-hidden border-y border-border/60">
      <div className="product-story-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
        <Reveal className="grid gap-8 lg:grid-cols-[1fr_0.62fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-cyan-500">Actual Beacon desktop capture</p>
            <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.04em] md:text-6xl">
              See the whole request lifecycle.
            </h2>
          </div>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground lg:pb-1">
            This is the current desktop app, not concept art. Send from the list, turn a response into reusable variables, assert the contract, then scale the run.
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
          <ScreenFrame src={workspaceShot} alt="Beacon 0.4.4 request builder with dynamic values, assertions, extractors, query parameters, headers, and cookies" priority />
          <div className="lg:pl-4">
            <div className="h-px w-16 bg-cyan-400" />
            <h3 className="mt-6 text-3xl font-semibold tracking-tight">The workspace is the control surface.</h3>
            <p className="mt-4 leading-7 text-muted-foreground">
              Compose API and Web requests with dynamic values, assertions, extraction rules, query parameters, headers, and cookies in one focused view.
            </p>
            <div className="mt-7 space-y-3 font-mono text-xs text-muted-foreground">
              <div className="flex items-center justify-between border-b border-border/70 pb-3"><span>SEND</span><span className="text-foreground">Endpoint row / editor</span></div>
              <div className="flex items-center justify-between border-b border-border/70 pb-3"><span>MODES</span><span className="text-foreground">Single / load / scenario</span></div>
              <div className="flex items-center justify-between border-b border-border/70 pb-3"><span>RELEASE</span><span className="text-foreground">0.4.4 desktop</span></div>
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
          <ScreenFrame src={scenarioResultsShot} alt="Beacon 0.4.4 Soak mode running with live requests per second, response time, error rate, and latency metrics" />
          <div className="lg:pl-4">
            <GitBranch className="h-7 w-7 text-cyan-500" />
            <h3 className="mt-6 text-3xl font-semibold tracking-tight">Pick the pressure profile.</h3>
            <p className="mt-4 leading-7 text-muted-foreground">
              Use Load for raw throughput, Scenario for complete user journeys, Rate Limit for quota discovery, or Soak for sustained endurance testing.
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

function HeroProductCapture() {
  const reduce = useReducedMotion()

  return (
    <motion.figure
      className="group relative min-h-[430px] min-w-0 sm:min-h-[500px] xl:min-h-[560px]"
      initial={reduce ? undefined : { opacity: 0, y: 26, scale: 0.97 }}
      animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
    >
      <div
        className="absolute inset-x-[8%] top-[12%] -z-10 h-[62%] rounded-[3rem] bg-blue-500/12 blur-3xl"
        aria-hidden="true"
      />

      <StackedProductShot
        src={workspaceShot}
        alt="Beacon desktop workspace showing a real API project and request editor"
        label="Workspace"
        eager
        className="absolute right-0 top-4 z-10 w-[92%] rotate-[1.2deg] transition-transform duration-500 ease-out group-hover:translate-y-[-4px] group-hover:rotate-[0.5deg]"
      />
      <StackedProductShot
        src={assertionsShot}
        alt="Beacon response assertions with passed and failed checks"
        label="Assertions"
        className="absolute bottom-5 left-0 z-20 w-[62%] -rotate-[3.5deg] transition-transform duration-500 ease-out group-hover:-translate-x-2 group-hover:translate-y-1 group-hover:-rotate-[5deg]"
      />
      <StackedProductShot
        src={scenarioResultsShot}
        alt="Beacon load test dashboard with live request and latency charts"
        label="Load test"
        className="absolute bottom-0 right-0 z-30 w-[60%] rotate-[3deg] transition-transform duration-500 ease-out group-hover:translate-x-2 group-hover:translate-y-2 group-hover:rotate-[4.5deg]"
      />
    </motion.figure>
  )
}

interface StackedProductShotProps {
  src: string
  alt: string
  label: string
  className: string
  eager?: boolean
}

function StackedProductShot({ src, alt, label, className, eager = false }: StackedProductShotProps) {
  return (
    <div className={`screen-frame overflow-hidden rounded-xl border border-border/90 bg-card shadow-2xl ${className}`}>
      <div className="flex h-7 items-center justify-between border-b border-border/70 bg-card/95 px-2.5 sm:h-8 sm:px-3">
        <div className="flex items-center gap-1" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400/80 sm:h-2 sm:w-2" />
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400/80 sm:h-2 sm:w-2" />
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80 sm:h-2 sm:w-2" />
        </div>
        <span className="font-mono text-[7px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:text-[8px]">
          {label}
        </span>
      </div>
      <div className="aspect-[1.55] overflow-hidden bg-muted/20">
        <img
          src={src}
          alt={alt}
          width="2056"
          height="1328"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover object-top"
        />
      </div>
    </div>
  )
}
