import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Activity,
  ArrowRight,
  Bot,
  Braces,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Download,
  FileDown,
  FileCode2,
  FolderKanban,
  Github,
  GitBranch,
  Globe2,
  History,
  Maximize2,
  Menu,
  MessagesSquare,
  PanelsTopLeft,
  Repeat,
  Send,
  ServerCog,
  ShieldCheck,
  SquareTerminal,
  Users,
  UserCheck,
  Webhook,
  Wifi,
  X,
} from 'lucide-react'
import { FaApple, FaLinux, FaWindows } from 'react-icons/fa'
import { ThemeToggle } from '../components/ThemeToggle'
import { BrandMark } from '../components/BrandMark'
import { NetworkBackground } from '../components/NetworkBackground'
import { ContributorWall } from '../components/ContributorWall'
import { HeroStats } from '../components/HeroStats'
import { startDownload } from '../lib/download'
import {
  BackToTopButton,
  CountUp,
  Reveal,
  RevealGroup,
  RevealItem,
  motion,
  useReducedMotion,
} from '../components/motion'
import requestBuilderShot from '../assets/features/request-builder-v047.png'
import responseAssertionsShot from '../assets/features/response-assertions-v047.png'
import scenarioConfigShot from '../assets/features/scenario-config-v047.png'
import scenarioResultsShot from '../assets/features/scenario-live-v047.png'
import liveMonitorShot from '../assets/features/live-monitor-v0410.png'
import environmentsShot from '../assets/features/environments-v047.png'
import runHistoryShot from '../assets/features/run-history-v0410.png'
import gitProjectShot from '../assets/features/git-project-sync-v047.png'
import mcpToolsShot from '../assets/features/mcp-tools-v047.png'
import cliShot from '../assets/features/cli-v047.png'

// URLs injected from the root .env via vite.config.ts (define block).
const DOCS_URL =
  (import.meta as any).env?.VITE_DOCS_URL || 'https://nannndev.github.io/beacon/'
const SUPPORT_URL =
  (import.meta as any).env?.VITE_SUPPORT_URL || 'https://buymeacoffee.com/ekaprasety8'
const GITHUB_URL =
  (import.meta as any).env?.VITE_GITHUB_URL || 'https://github.com/nannndev/beacon'
const RELEASE_VERSION = '0.5.0'
const RELEASE_URL = `${GITHUB_URL}/releases/tag/v${RELEASE_VERSION}`
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
              className="hidden items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
            >
              All platforms
            </a>

            {/* One primary action in the header. The neighbouring link used to
                also read "Download" while only scrolling to the platform
                cards, so the two were indistinguishable. */}
            <button
              onClick={download}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-bold text-background shadow-sm transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              <Download className="h-4 w-4" />
              Download
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

      <section className="relative mx-auto grid w-full max-w-7xl items-center gap-x-10 gap-y-7 px-5 pb-10 pt-9 lg:px-8 lg:pb-14 lg:pt-12 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="hero-atmosphere absolute inset-0 -z-10" aria-hidden="true" />

        <RevealGroup className="max-w-2xl" stagger={0.08} delayChildren={0.05}>
          <RevealItem className="mb-4 inline-flex items-center rounded-full border border-border/60 bg-card/60 px-3 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground">
            FREE AND OPEN SOURCE
          </RevealItem>

          <RevealItem as="div">
            <h1 className="text-balance text-5xl font-semibold leading-[0.98] tracking-[-3px] md:text-[62px] md:tracking-[-3.6px]">
              Your API workspace,<br />on your machine.
            </h1>
          </RevealItem>

          <RevealItem
            as="div"
            className="mt-5 max-w-xl text-pretty text-base leading-7 text-muted-foreground"
          >
            Send requests, chain logins, assert responses, and push real load at your
            endpoints. No account and no cloud sync — your tokens, responses, and run
            history stay local.
          </RevealItem>

          <RevealItem className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={download}
              className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-7 text-[15px] font-semibold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
            >
              Download for free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            <a
              href="#product-preview"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-6 text-[15px] font-semibold transition-all hover:bg-muted hover:border-border active:scale-[0.985]"
            >
              See it in action
            </a>
          </RevealItem>

          <RevealItem>
            <HeroStats />
          </RevealItem>
        </RevealGroup>

        <HeroProductCapture />
      </section>

      <section id="workspace" className="border-y border-border/60 bg-muted/15">
        <RevealGroup className="mx-auto grid max-w-7xl gap-px bg-border/70 px-5 py-px sm:grid-cols-2 lg:grid-cols-4 lg:px-8" stagger={0.05}>
          {[
            { icon: FolderKanban, title: 'Nested folders', body: 'Group endpoints by service or feature, the way your codebase already is.' },
            { icon: Globe2, title: 'Environments', body: 'Point the same requests at local, staging, or production in one click.' },
            { icon: Braces, title: 'Live variables', body: 'Generate fake data per request and reuse tokens captured from real responses.' },
            { icon: History, title: 'Run history', body: 'Reopen any past run with its responses, timings, and logs intact.' },
          ].map(({ icon: Icon, title, body }) => (
            <RevealItem key={title} as="article" className="group bg-background/90 px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 transition-transform duration-300 group-hover:scale-105">
                  <Icon className="h-4 w-4" />
                </div>
                <h2 className="text-sm font-semibold tracking-tight group-hover:text-cyan-400 transition-colors">{title}</h2>
              </div>
              <p className="mt-2 pl-11 text-xs leading-5 text-muted-foreground">{body}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      <FeatureGallery />

      <section id="features" className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
        <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
          <Reveal>
            <p className="text-sm font-bold text-cyan-500">Everything around the request</p>
            <h2 className="mt-2 text-balance text-3xl font-extrabold tracking-tight md:text-4xl">
              One app instead of four.
            </h2>
            <p className="mt-4 max-w-lg text-pretty text-sm leading-6 text-muted-foreground">
              The request client, the assertion suite, the load generator, and the CI
              runner all read the same project file. Nothing to export, nothing to keep
              in sync.
            </p>
          </Reveal>

          <RevealGroup className="grid gap-3 sm:grid-cols-2" stagger={0.05}>
            {[
              { icon: Send, title: 'Send & inspect', body: 'Fire one request and read the status, timing, headers, and formatted body immediately.' },
              { icon: ShieldCheck, title: 'Assertions', body: 'Turn status, latency, headers, body text, and JSON paths into pass/fail checks.' },
              { icon: GitBranch, title: 'Scenarios', body: 'Chain login → setup → protected call, carrying tokens forward as each step returns them.' },
              { icon: FileCode2, title: 'Any body type', body: 'JSON, form data, multipart uploads, raw text, XML, and GraphQL are all first class.' },
              { icon: Activity, title: 'Live monitoring', body: 'Throughput, latency percentiles, errors, and rate limits update while the run is still going.' },
              { icon: Repeat, title: 'Eight traffic modes', body: 'Load, ramp, spike, soak, rate probe, capacity search, fuzz, and benchmark — per endpoint.' },
              { icon: GitBranch, title: 'Git-backed projects', body: 'Readable YAML you can diff, commit, branch, and review without leaving Beacon.' },
              { icon: Users, title: 'LAN sharing', body: 'Teammates sync the project over your network. Secrets and responses stay on each device.' },
              { icon: SquareTerminal, title: 'Headless CLI', body: 'Validate and run the same project from a terminal, using the identical local engine.' },
              { icon: Github, title: 'GitHub Actions', body: 'Generate a workflow that fails the PR when an assertion breaks, with step summaries.' },
              { icon: ServerCog, title: 'API mocking', body: 'Stand up local catch-all mock routes with configurable status, headers, bodies, and dynamic variables.' },
              { icon: FileCode2, title: 'Code snippets', body: 'Turn any request into cURL, JavaScript, Python, Go, or raw HTTP without rebuilding it by hand.' },
              { icon: Webhook, title: 'Run alerts', body: 'Send color-coded test results to Slack or Discord as soon as a run finishes.' },
              { icon: FileDown, title: 'Portable reports', body: 'Export a self-contained HTML performance report, then print it directly to PDF.' },
            ].map(({ icon: Icon, title, body }) => (
              <RevealItem key={title} as="article" className="liquid-glass liquid-glass-interactive group rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-500/10 text-cyan-400 transition group-hover:scale-105">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h3 className="font-semibold tracking-tight">{title}</h3>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{body}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </section>

      <section id="sharing" className="relative scroll-mt-20 overflow-hidden border-y border-border/60 bg-muted/15">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(6,182,212,0.10),transparent_34%),radial-gradient(circle_at_80%_70%,rgba(59,130,246,0.08),transparent_36%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-8 px-5 py-14 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:px-8 lg:py-16">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-4 py-1 text-xs font-semibold tracking-widest text-cyan-600 dark:text-cyan-400">
              <Wifi className="h-3.5 w-3.5" /> LOCAL-FIRST TEAMWORK
            </div>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-4xl">Share the project, not your credentials.</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              Endpoint definitions sync to teammates over your local network — no server in
              between. Everyone's requests, responses, run history, and private environment
              values stay on their own device.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {[
                [UserCheck, 'Trusted devices', 'Pairing codes, owner approval, roles, and automatic trusted reconnect.'],
                [ShieldCheck, 'Pinned HTTPS', 'Beacon blocks synchronization if the host certificate fingerprint changes.'],
                [GitBranch, 'Conflict-safe revisions', 'Three-way merge preserves unrelated edits and exposes field conflicts.'],
                [PanelsTopLeft, 'Local execution', 'Requests, responses, history, and private values stay on each device.'],
              ].map(([Icon, title, body]) => {
                const SharingIcon = Icon as typeof Users
                return <div key={title as string} className="rounded-xl border border-border/70 bg-background/65 p-3 backdrop-blur-xl">
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

      <section id="workflow" className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
        <Reveal className="liquid-glass rounded-2xl p-6 md:p-8">
          <div className="flex flex-col justify-between gap-5 border-b border-border pb-6 md:flex-row md:items-end">
            <div>
              <div className="text-sm font-semibold tracking-widest text-cyan-400">WORKFLOW</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">One request today. A thousand tomorrow.</h2>
            </div>
            <button
              onClick={download}
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-6 text-sm font-semibold transition-all hover:bg-muted"
            >
              Download <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>

          <RevealGroup className="grid gap-3 pt-6 md:grid-cols-4" stagger={0.07}>
            {[
              ['Build the request', 'Method, URL, auth, body, and variables — with live previews as you type.'],
              ['Send it once', 'Inspect the response and capture any value you need for the next call.'],
              ['Define success', 'Add checks on status, latency, headers, body text, or JSON paths.'],
              ['Turn up the load', 'Repeat one endpoint, or send virtual users through the whole journey.'],
            ].map(([title, body], index) => (
              <RevealItem key={title} className="group relative rounded-xl border border-border/50 bg-background/60 p-4 transition-colors hover:border-cyan-500/30">
                <div className="mb-2 font-mono text-[10px] font-bold text-cyan-500/70">0{index + 1}</div>
                <div className="text-base font-semibold tracking-tight">{title}</div>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{body}</p>
              </RevealItem>
            ))}
          </RevealGroup>

          <div className="mt-6 grid gap-4 border-t border-border pt-6 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <SquareTerminal className="h-4 w-4 text-cyan-500" /> Same project, headless when needed
              </div>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                Validate and run from the CLI, then generate a GitHub Actions workflow for pull requests.
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-slate-950 px-4 py-3 font-mono text-[11px] text-slate-300 sm:flex-row sm:items-center sm:justify-between">
              <code className="truncate"><span className="text-cyan-400">$</span> beacon validate . &amp;&amp; beacon run . --github</code>
              <code className="shrink-0 text-slate-500">beacon ci init github</code>
            </div>
          </div>
        </Reveal>
      </section>

      <section id="mcp" className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-1 text-xs font-semibold tracking-widest text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-cyan-400" /> MCP INTEGRATION
            </div>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              Hand the workspace to your agent.
            </h2>
            <p className="mt-4 max-w-lg text-pretty text-sm leading-6 text-muted-foreground">
              Beacon ships a standard MCP server — not Claude-only — so any assistant can
              drive the projects you already have. It exposes{' '}
              <span className="font-semibold text-foreground">
                <CountUp value={21} durationMs={900} /> tools
              </span>{' '}
              for creating, importing, sending, asserting, chaining, and load-testing
              endpoints, all through the same local engine you use by hand.
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
        <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-4xl font-semibold tracking-tighter">
              Download it. Open it. Start sending.
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              One installer with the engine, CLI, and MCP server already inside. No Python
              to install, no account to create, nothing to configure first.
            </p>
          </Reveal>

          <RevealGroup className="mx-auto mt-8 grid max-w-7xl gap-4 md:grid-cols-3" stagger={0.08}>
            <RevealItem as="article" className="platform-card platform-card-windows group flex min-h-[18rem] flex-col rounded-2xl p-5">
              <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span>Windows</span>
                <span>x64</span>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[#0078d4]/30 bg-[#0078d4]/10">
                  <FaWindows className="h-6 w-6 text-[#168be3]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight">Beacon for Windows</div>
                  <div className="mt-1 text-sm text-muted-foreground">Windows 10 &amp; 11</div>
                </div>
              </div>
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                Native installer with the Beacon backend and MCP server bundled in.
              </p>
              <div className="mt-4 flex gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="rounded-full border border-border bg-background/60 px-2.5 py-1">EXE</span>
                <span className="rounded-full border border-border bg-background/60 px-2.5 py-1">Desktop</span>
              </div>
              <button
                onClick={() => void startDownload('windows')}
                className="mt-auto flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0878c9] px-6 text-sm font-semibold text-white shadow-[0_10px_28px_rgb(0_120_212_/_0.22)] transition-transform hover:-translate-y-px active:scale-[0.985]"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download EXE
              </button>
            </RevealItem>

            <RevealItem as="article" className="platform-card platform-card-macos group flex min-h-[18rem] flex-col rounded-2xl p-5">
              <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span>macOS</span>
                <span>Apple silicon</span>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border bg-foreground text-background shadow-sm">
                  <FaApple className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight">Beacon for macOS</div>
                  <div className="mt-1 text-sm text-muted-foreground">Apple Silicon DMG</div>
                </div>
              </div>
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                Unsigned community build. macOS may block the first launch until Gatekeeper is cleared once.
              </p>
              <details className="mt-4 rounded-xl border border-border bg-background/55 px-3 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none font-medium text-foreground">First-launch command</summary>
                <code className="mt-2 block overflow-x-auto font-mono text-[10px]">xattr -dr com.apple.quarantine /Applications/Beacon.app</code>
              </details>
              <button
                onClick={() => void startDownload('mac')}
                className="mt-auto flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-6 text-sm font-semibold text-background transition-transform hover:-translate-y-px active:scale-[0.985]"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download DMG
              </button>
            </RevealItem>

            <RevealItem as="article" className="platform-card platform-card-linux group flex min-h-[18rem] flex-col rounded-2xl p-5">
              <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span>Linux</span>
                <span>x64</span>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[#fcc624]/25 bg-[#fcc624]/10">
                  <FaLinux className="h-7 w-7 text-[#fcc624]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight">Beacon for Linux</div>
                  <div className="mt-1 text-sm text-muted-foreground">Portable or native package</div>
                </div>
              </div>
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                Run the AppImage on most distributions, or install the native package on Debian and Ubuntu.
              </p>
              <div className="mt-4 flex gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="rounded-full border border-border bg-background/60 px-2.5 py-1">AppImage</span>
                <span className="rounded-full border border-border bg-background/60 px-2.5 py-1">DEB</span>
              </div>
              <button
                onClick={() => void startDownload('linux')}
                className="mt-auto flex h-11 items-center justify-center gap-2 rounded-xl bg-[#e6b30e] px-6 text-sm font-semibold text-black shadow-[0_10px_28px_rgb(252_198_36_/_0.16)] transition-transform hover:-translate-y-px active:scale-[0.985]"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download AppImage
              </button>
            </RevealItem>
          </RevealGroup>

          <div className="mt-5 text-center text-xs text-muted-foreground">
            Install, open Beacon, and start testing locally. No Python runtime or hosted Beacon account required.
          </div>
        </div>
      </section>

      <section id="release" className="border-t border-border/60 bg-muted/10">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-start lg:px-8 lg:py-16">
          <Reveal>
            <History className="h-7 w-7 text-cyan-500" />
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-4xl">What changed in {RELEASE_VERSION}</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              Mock APIs locally, move requests in and out faster, notify the team when a
              run finishes, and hand stakeholders a report they can open anywhere.
            </p>
            <a href={RELEASE_URL} target="_blank" rel="noopener" className="group mt-7 inline-flex items-center gap-2 text-sm font-semibold text-cyan-500 hover:text-cyan-400">
              Read the full release notes <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </Reveal>

          <RevealGroup className="grid gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/70" stagger={0.07}>
            {[
              ['Mock without another server', 'Create catch-all local API routes with custom status, headers, bodies, and fresh dynamic template values.'],
              ['Copy requests both ways', 'Paste cURL from browser DevTools, or generate cURL, Fetch, Python, Go, and raw HTTP from any endpoint.'],
              ['Alert the team automatically', 'Send color-coded completion summaries to Slack or Discord through project-level webhooks.'],
              ['Share an executive report', 'Export an offline HTML report with latency percentiles, outcome charts, and a print-ready PDF layout.'],
            ].map(([title, body]) => (
              <RevealItem key={title} className="bg-background/80 px-5 py-4 md:grid md:grid-cols-[0.35fr_0.65fr] md:gap-5">
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground md:mt-0">{body}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </section>

      <section id="contributors" className="border-t border-border/60 bg-muted/15">
        <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
          <Reveal className="max-w-3xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-500">
              <Users className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              Built in the open, by people who use it.
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Fix a bug, try a pre-release, sharpen the docs, or just open an issue about
              the thing that annoyed you. All of it counts.
            </p>
          </Reveal>
          <Reveal className="mt-7" delay={0.08}>
            <ContributorWall />
          </Reveal>
          <a
            href="/contributors/"
            className="group mt-6 inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold transition-all hover:-translate-y-px hover:bg-muted active:scale-[0.985]"
          >
            See how to contribute <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </section>

      <section id="support" className="border-t border-border/60">
        <Reveal className="mx-auto max-w-3xl px-5 py-14 text-center lg:px-8 lg:py-16">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-1 text-xs font-semibold tracking-widest text-amber-600 dark:text-amber-400">
            <Coffee className="h-3.5 w-3.5" /> SUPPORT THE PROJECT
          </div>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            Keep Beacon independent and open.
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            No investors and no paid tier. Sponsor the work, send a patch, or help decide
            what gets built next.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
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
            <a href="#release" className="hover:text-foreground">Changelog</a>
            <a href="/contributors/" className="hover:text-foreground">Contributors</a>
            <a href="#support" className="hover:text-foreground">Support</a>
            <a href={DISCORD_URL} target="_blank" rel="noopener" className="hover:text-foreground">Discord</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener" className="hover:text-foreground">GitHub</a>
            <a href={DOCS_URL} target="_blank" rel="noopener" className="hover:text-foreground">Documentation</a>
          </div>
          <div className="text-xs">Local-first API work, built in the open.</div>
        </div>
      </footer>
      <BackToTopButton />
    </main>
  )
}

function FeatureGallery() {
  const AUTO_SLIDE_MS = 6500
  const slides = [
    {
      label: 'Request builder',
      title: 'Build the request without losing context.',
      body: 'Set auth, payloads, query parameters, dynamic values, extractors, and assertions from one real endpoint screen.',
      src: requestBuilderShot,
      alt: 'Beacon request builder showing payload fields, response extractors, query parameters, and assertions',
    },
    {
      label: 'Response & assertions',
      title: 'Inspect the response. Prove the behavior.',
      body: 'Read structured JSON, response metadata, and every assertion result side by side after a real request.',
      src: responseAssertionsShot,
      alt: 'Beacon response inspector showing structured JSON and four passed assertions',
    },
    {
      label: 'Scenario setup',
      title: 'Choose the traffic before you press run.',
      body: 'Start from an understandable preset, then tune users, iterations, ramp-up, retries, and failure behavior.',
      src: scenarioConfigShot,
      alt: 'Beacon Scenario mode showing traffic presets and test configuration controls',
    },
    {
      label: 'Scenario journey',
      title: 'See the journey while it runs.',
      body: 'Follow active users across each endpoint and inspect latency, failures, and recent requests per step.',
      src: scenarioResultsShot,
      alt: 'Beacon Scenario mode running a project journey with active users and endpoint steps',
    },
    {
      label: 'Live monitor',
      title: 'Watch the run, not a spinner.',
      body: 'Track KPI sparklines, throughput, latency, errors, outcomes, and individual responses while the test is still moving.',
      src: liveMonitorShot,
      alt: 'Beacon Live Monitor showing KPI sparklines, request rate, response time, error rate, and live responses',
    },
    {
      label: 'Environments',
      title: 'Switch targets without rewriting requests.',
      body: 'Keep base URLs, shared variables, auth, and local private values organized per environment.',
      src: environmentsShot,
      alt: 'Beacon environment editor showing a base URL and reusable variables',
    },
    {
      label: 'Run history',
      title: 'Come back to every useful result.',
      body: 'Review interactive trends, response outcomes, latency distribution, and previous runs on one observability dashboard.',
      src: runHistoryShot,
      alt: 'Beacon run history dashboard showing KPI trends, charts, response outcomes, and latency distribution',
    },
    {
      label: 'Git & local sharing',
      title: 'Keep the project in Git or share it nearby.',
      body: 'Review readable YAML, sync branches, and share project source over the local network while private values stay local.',
      src: gitProjectShot,
      alt: 'Beacon Project Settings showing Git synchronization, branches, and local project sharing',
    },
    {
      label: 'MCP tools',
      title: 'Let your AI agent work inside Beacon.',
      body: 'Connect Cursor, Windsurf, Cline, VS Code, or Zed and give the agent a focused set of Beacon project and test tools.',
      src: mcpToolsShot,
      alt: 'Beacon MCP Server page showing AI client setup and available tools',
    },
    {
      label: 'CLI & CI',
      title: 'Run the same project without opening the app.',
      body: 'Validate files, target endpoints or folders, pass local secrets, and generate a GitHub Actions workflow from the built-in guide.',
      src: cliShot,
      alt: 'Beacon CLI documentation showing commands, variables, and GitHub Actions setup',
    },
  ]
  const [selected, setSelected] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [inView, setInView] = useState(false)
  const [direction, setDirection] = useState(1)
  const galleryRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const paused = hovered || focusWithin
  const active = slides[selected]

  useEffect(() => {
    const node = galleryRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.3 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (reduce || paused || expanded || !inView) return
    const timer = window.setTimeout(() => {
      setDirection(1)
      setSelected((current) => (current + 1) % slides.length)
    }, AUTO_SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [selected, paused, expanded, inView, reduce, slides.length])

  useEffect(() => {
    if (!expanded) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = ''
    }
  }, [expanded])

  const move = (direction: number) => {
    setDirection(direction > 0 ? 1 : -1)
    setSelected((current) => (current + direction + slides.length) % slides.length)
  }

  const select = (index: number) => {
    setDirection(index >= selected ? 1 : -1)
    setSelected(index)
  }

  return (
    <section id="product-preview" className="product-story relative scroll-mt-20 overflow-hidden border-y border-border/60">
      <div className="product-story-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
        <Reveal className="max-w-3xl">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-cyan-500">Inside Beacon desktop</p>
          <h2 className="mt-3 text-balance text-4xl font-semibold tracking-[-0.04em] md:text-5xl">The whole workflow, one screen at a time.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Pick a feature below. Click the screenshot when you want to inspect the full interface.</p>
        </Reveal>

        <Reveal
          className="mt-8 overflow-hidden rounded-2xl border border-border/80 bg-background/75 shadow-2xl backdrop-blur-xl"
        >
          <div
            ref={galleryRef}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocusWithin(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false)
            }}
          >
          <div className="grid lg:grid-cols-[0.34fr_0.66fr]">
            <div className="flex flex-col justify-between border-b border-border p-5 lg:border-b-0 lg:border-r lg:p-7">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={active.label}
                  custom={direction}
                  initial={reduce ? false : { opacity: 0, x: direction * 18, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={reduce ? undefined : { opacity: 0, x: direction * -12, filter: 'blur(4px)' }}
                  transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                  className="min-h-[9.5rem]"
                >
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-500">{active.label}</div>
                  <h3 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">{active.title}</h3>
                  <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{active.body}</p>
                </motion.div>
              </AnimatePresence>
              <div className="mt-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{String(selected + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span>
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    <span className={`h-1.5 w-1.5 rounded-full ${paused || reduce ? 'bg-muted-foreground/50' : 'bg-cyan-500'}`} />
                    {reduce ? 'Manual' : paused ? 'Paused' : 'Auto'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => move(-1)} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card transition hover:bg-muted active:scale-95" aria-label="Previous feature">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => move(1)} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card transition hover:bg-muted active:scale-95" aria-label="Next feature">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <button type="button" onClick={() => setExpanded(true)} className="group relative min-w-0 overflow-hidden bg-muted/20 text-left" aria-label={`Open ${active.label} screenshot full screen`}>
              <div className="flex h-9 items-center gap-1.5 border-b border-border/70 bg-muted/35 px-4">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground"><Maximize2 className="h-3.5 w-3.5" /> Expand</span>
              </div>
              <div className="aspect-[16/9] overflow-hidden">
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                  <motion.img
                    key={active.src}
                    src={active.src}
                    alt={active.alt}
                    width="2056"
                    height="1328"
                    loading="eager"
                    decoding="async"
                    custom={direction}
                    initial={reduce ? false : { opacity: 0, x: direction * 26, scale: 1.015 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={reduce ? undefined : { opacity: 0, x: direction * -18, scale: 0.99 }}
                    transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full w-full object-cover object-top group-hover:scale-[1.01]"
                  />
                </AnimatePresence>
              </div>
            </button>
          </div>

          <div className="h-0.5 overflow-hidden bg-border/50" aria-hidden="true">
            {!reduce && !paused && inView && !expanded && (
              <motion.div
                key={`progress-${selected}`}
                className="h-full bg-cyan-500"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: AUTO_SLIDE_MS / 1000, ease: 'linear' }}
                style={{ transformOrigin: 'left center' }}
              />
            )}
          </div>

          <div className="flex snap-x gap-2 overflow-x-auto border-t border-border p-3 [scrollbar-width:thin]">
            {slides.map((slide, index) => (
              <button key={slide.label} type="button" onClick={() => select(index)} className={`min-w-[9.5rem] snap-start rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${selected === index ? 'border-cyan-500/50 bg-cyan-500/10 text-foreground' : 'border-border/70 bg-card/60 text-muted-foreground hover:bg-muted hover:text-foreground'}`} aria-pressed={selected === index}>
                <span className="block truncate text-xs font-semibold">{slide.label}</span>
                <span className="mt-1 block truncate font-mono text-[9px]">{String(index + 1).padStart(2, '0')}</span>
              </button>
            ))}
          </div>
          </div>
        </Reveal>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-background/92 p-3 backdrop-blur-2xl md:p-8" role="dialog" aria-modal="true" aria-label={`${active.label} screenshot preview`} onClick={() => setExpanded(false)}>
          <div className="relative flex max-h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 md:px-5">
              <div>
                <div className="text-sm font-semibold">{active.label}</div>
                <div className="hidden text-xs text-muted-foreground sm:block">{active.title}</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => move(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-muted" aria-label="Previous screenshot"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => move(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-muted" aria-label="Next screenshot"><ChevronRight className="h-4 w-4" /></button>
                <button type="button" onClick={() => setExpanded(false)} className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-muted" aria-label="Close screenshot preview"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-2 md:p-4">
              <img key={active.src} src={active.src} alt={active.alt} width="2056" height="1328" className="mx-auto block h-auto max-h-[calc(100dvh-7.5rem)] w-auto max-w-full rounded-lg object-contain" />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function HeroProductCapture() {
  const reduce = useReducedMotion()

  return (
    <motion.figure
      className="group relative min-h-[390px] min-w-0 sm:min-h-[450px] xl:min-h-[500px]"
      initial={reduce ? undefined : { opacity: 0, y: 26, scale: 0.97 }}
      animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
    >
      <div
        className="absolute inset-x-[8%] top-[12%] -z-10 h-[62%] rounded-[3rem] bg-blue-500/12 blur-3xl"
        aria-hidden="true"
      />

      <StackedProductShot
        src={requestBuilderShot}
        alt="Beacon desktop request builder showing payloads, extractors, query parameters, and assertions"
        label="Request builder"
        eager
        className="absolute right-0 top-4 z-10 w-[92%] rotate-[1.2deg] transition-transform duration-500 ease-out group-hover:translate-y-[-4px] group-hover:rotate-[0.5deg]"
      />
      <StackedProductShot
        src={gitProjectShot}
        alt="Beacon project settings with Git synchronization and local project sharing"
        label="Git & sharing"
        className="absolute bottom-5 left-0 z-20 w-[62%] -rotate-[3.5deg] transition-transform duration-500 ease-out group-hover:-translate-x-2 group-hover:translate-y-1 group-hover:-rotate-[5deg]"
      />
      <StackedProductShot
        src={scenarioResultsShot}
        alt="Beacon Scenario journey with active users, endpoint steps, and recent request activity"
        label="Scenario"
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
