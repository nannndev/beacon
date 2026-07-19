import { ArrowRight, Braces, FolderKanban, Globe2, History } from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { ThemeToggle } from '../components/ThemeToggle'

interface Props {
  onGetStarted: () => void
}

const HIGHLIGHTS = [
  { icon: FolderKanban, title: 'Collections', body: 'Group endpoints by product area, environment, or release.' },
  { icon: Globe2, title: 'Environments', body: 'Switch base URLs and variables without touching every request.' },
  { icon: Braces, title: 'Templating', body: 'Dynamic values: random email, UUID, timestamp, and chained tokens.' },
  { icon: History, title: 'Live runs', body: 'Watch attempts, success, rate limits, and timing as tests execute.' },
]

// First-run welcome shown once (gated by localStorage in App). This is app
// onboarding, NOT the marketing landing page — that lives in the separate
// `landing/` project.
export default function Onboarding({ onGetStarted }: Props) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-5 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,hsl(var(--muted)/0.5)_0%,transparent_65%)]" />

      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-6 text-balance text-4xl font-bold tracking-tight md:text-5xl">
            Welcome to Beacon
          </h1>
          <p className="mt-4 max-w-lg text-pretty text-[15px] leading-relaxed text-muted-foreground">
            A focused workspace for API collections, environments, dynamic requests, and
            high-fidelity load testing. Your first workspace is preloaded with 47 safe
            JSONPlaceholder CRUD examples, so you can run a test immediately.
          </p>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-border bg-card/60 p-5 text-left">
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500 dark:text-cyan-400">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <h2 className="font-semibold tracking-tight">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <button
            onClick={onGetStarted}
            className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-foreground px-8 text-[15px] font-semibold text-background shadow-xl transition-all hover:-translate-y-px active:scale-[0.985]"
          >
            Get started
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Beacon is free &amp; open —{' '}
          <a
            href="https://buymeacoffee.com/ekaprasety8"
            target="_blank"
            rel="noopener"
            className="font-medium text-amber-600 hover:underline dark:text-amber-400"
          >
            buy me a coffee ☕
          </a>
        </p>
      </div>
    </div>
  )
}
