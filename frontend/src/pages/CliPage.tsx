import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Copy, FileJson, Github, Play, RefreshCw, ShieldCheck, SquareTerminal } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { toast } from '../components/ui/toast'
import { getCliPath } from '../lib/cli'
import { isDesktop } from '../lib/platform'


interface Props {
  onBack: () => void
}

const COMMANDS = [
  { command: 'beacon --version', description: 'Show the installed CLI version.' },
  { command: 'beacon run --help', description: 'Open the terminal command reference.' },
  { command: 'beacon validate .', description: 'Check project files, variables, assertions, and extractors without sending a request.' },
  { command: 'beacon list endpoints .', description: 'Discover endpoint names, folder paths, and stable IDs.' },
  { command: 'beacon ci init github .', description: 'Generate a safe GitHub Actions workflow for this project.' },
  { command: 'beacon run .', description: 'Run the full project in manifest order.' },
  { command: 'beacon run . --env staging', description: 'Use an environment by name or ID.' },
  { command: 'beacon run . --folder Auth', description: 'Run every endpoint below one folder.' },
  { command: 'beacon run . --endpoint Login', description: 'Run one endpoint by name or stable ID.' },
  { command: 'beacon run . --endpoint Login --endpoint Profile', description: 'Run selected endpoints in the given order.' },
  { command: 'beacon run . --iterations 3 --bail', description: 'Repeat the scope and stop on the first failure.' },
]

const OPTIONS = [
  ['--env NAME_OR_ID', 'Choose an environment. Defaults to the project’s active environment.'],
  ['--env-file PATH', 'Load local KEY=VALUE overrides without committing secrets.'],
  ['--env-var KEY=VALUE', 'Override one variable. Repeat the flag for multiple values.'],
  ['--endpoint NAME_OR_ID', 'Run one endpoint. Repeat to preserve a custom execution order.'],
  ['--folder NAME_OR_ID', 'Run all nested endpoints in a folder.'],
  ['--iterations N', 'Repeat the selected scope. Default: 1.'],
  ['--retries N', 'Retry transport errors or non-2xx responses. Default: 0.'],
  ['--retry-delay MS', 'Wait between retries in milliseconds.'],
  ['--bail', 'Stop after the first failed HTTP request or assertion.'],
  ['--report-json PATH', 'Write the Beacon machine-readable report format.'],
  ['--report-junit PATH', 'Write JUnit XML for GitHub, GitLab, Jenkins, and other CI systems.'],
  ['--github', 'Write a GitHub Actions job summary and safe failure annotations.'],
  ['--quiet', 'Hide per-request output and print the final summary.'],
  ['--no-color', 'Disable ANSI colors. NO_COLOR is also respected.'],
]

const DISCOVERY_OPTIONS = [
  ['beacon validate [PROJECT]', 'Run the complete project preflight without network traffic.'],
  ['--strict', 'Make ambiguous-name warnings fail validation.'],
  ['--json', 'Return structured validation diagnostics or list results.'],
  ['beacon list endpoints [PROJECT]', 'List method, name, folder, URL, and stable endpoint ID.'],
  ['beacon list folders [PROJECT]', 'List folder paths, contained endpoint counts, and IDs.'],
  ['beacon list environments [PROJECT]', 'List environments, base URLs, active state, and IDs.'],
]

const CI_OPTIONS = [
  ['beacon ci init github [PROJECT]', 'Create .github/workflows/beacon.yml in the repository that contains the project.'],
  ['--env NAME_OR_ID', 'Generate the workflow for a specific environment. Defaults to the active environment.'],
  ['--cli-version VERSION', 'Pin the workflow to a Beacon release. Defaults to this CLI version; use latest only when desired.'],
  ['--dry-run', 'Print the complete workflow without writing a file.'],
  ['--force', 'Replace an existing Beacon workflow after reviewing the dry-run output.'],
  ['--repo-root PATH', 'Select the repository root explicitly when automatic Git discovery is not enough.'],
]

export function CliPage({ onBack }: Props) {
  const desktop = isDesktop()
  const [cliPath, setCliPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!desktop) return
    setLoading(true)
    setError(null)
    try {
      setCliPath(await getCliPath())
    } catch (cause: any) {
      setError(String(cause?.message ?? cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const executable = cliPath || 'beacon'
  const firstRun = `${quote(executable)} run /path/to/beacon-project --env CI`
  const action = `name: Beacon API tests
on: [push, pull_request]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Beacon CLI
        run: |
          curl -fsSL https://github.com/nannndev/beacon/releases/download/v0.4.9/beacon-linux-x64 -o beacon
          chmod +x beacon
          sudo mv beacon /usr/local/bin/beacon
      - name: Run Beacon
        env:
          BEACON_VAR_API_TOKEN: \${{ secrets.API_TOKEN }}
        run: |
          beacon validate ./api-tests --env CI --strict
          beacon run ./api-tests --env CI --bail --quiet --github --report-junit api-tests/reports/beacon.xml`

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="history-action"><ArrowLeft className="h-3.5 w-3.5" /> Workspace</button>
          <div className="h-6 border-l border-border" />
          <SquareTerminal className="h-5 w-5 text-cyan-500" />
          <div>
            <h1 className="text-sm font-bold">Beacon CLI</h1>
            <p className="text-[10px] text-muted-foreground">Run Git-backed projects locally or in CI</p>
          </div>
        </div>
        {desktop && (
          <button onClick={refresh} className="history-action"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Resolve path</button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">{error}</div>}

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">Run the same checks without opening Beacon</h2>
                <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">Headless</Badge>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                The CLI reads the same beacon.yaml, endpoint files, assertions, extractors, and environments as the desktop app. Requests run on this machine and results never require a Beacon account.
              </p>
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">First run</div>
                <CopyCommand value={firstRun} />
              </div>
            </Card>

            <Card className="space-y-3 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><SquareTerminal className="h-4 w-4 text-cyan-500" /> Installed executable</div>
              {desktop ? (
                <CopyCommand value={cliPath} placeholder={loading ? 'Resolving CLI path…' : 'CLI path is unavailable'} />
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">Install the Beacon desktop build or build the CLI from source. The desktop app stages a standalone executable that does not require Python.</p>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Add its folder to PATH to use <code className="rounded bg-muted px-1">beacon</code> anywhere, or call the absolute path shown above.
              </p>
              <div className="flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
                Secrets stay local. The CLI reads .beacon overrides, BEACON_VAR_* values, an env file, or explicit flags.
              </div>
            </Card>
          </div>

          <section>
            <div className="mb-3 flex items-center gap-2"><Play className="h-4 w-4 text-cyan-500" /><h2 className="text-sm font-bold">Common commands</h2></div>
            <div className="grid gap-3 md:grid-cols-2">
              {COMMANDS.map((item) => (
                <Card key={item.command} className="p-3">
                  <CopyCommand value={item.command} compact />
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{item.description}</p>
                </Card>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-500" /><h2 className="text-sm font-bold">Variables and secrets</h2></div>
              <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
                <p>Precedence is: saved environment, env file, <code className="text-foreground">BEACON_VAR_*</code>, then <code className="text-foreground">--env-var</code>.</p>
                <CopyCommand value="BEACON_VAR_API_TOKEN=secret beacon run . --env CI" compact />
                <CopyCommand value="beacon run . --env-file .env.ci --env-var tenant=preview" compact />
                <p>A variable named <code className="text-foreground">api-token</code> maps to <code className="text-foreground">BEACON_VAR_API_TOKEN</code>. Missing private values fail before any request is sent.</p>
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2"><Github className="h-4 w-4 text-cyan-500" /><h2 className="text-sm font-bold">GitHub Actions</h2></div>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Generate the workflow from the repository root. Beacon detects the linked project path, pins the current CLI release, and prints the GitHub secret names you need to add.</p>
              <CopyCommand value="beacon ci init github ." compact />
              <p className="my-3 text-[11px] leading-relaxed text-muted-foreground">Preview safely with <code className="text-foreground">--dry-run</code>. Existing workflows are never replaced unless you add <code className="text-foreground">--force</code>.</p>
              <CopyBlock value={action} />
              <p className="mt-2 text-[10px] text-muted-foreground">The generated job adds a visual summary and safe failure annotations to GitHub. Assertion values and response secrets are excluded.</p>
            </Card>
          </div>

          <section>
            <div className="mb-3 flex items-center gap-2"><FileJson className="h-4 w-4 text-cyan-500" /><h2 className="text-sm font-bold">Command reference</h2></div>
            <Card className="mb-4 overflow-hidden">
              <div className="border-b border-border/70 px-4 py-3 text-xs font-bold">Preflight and discovery</div>
              <div className="grid divide-y divide-border/70">
                {DISCOVERY_OPTIONS.map(([option, description]) => (
                  <div key={option} className="grid gap-1 px-4 py-3 md:grid-cols-[260px_1fr] md:gap-5">
                    <code className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">{option}</code>
                    <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="mb-4 overflow-hidden">
              <div className="border-b border-border/70 px-4 py-3 text-xs font-bold">CI workflow generation</div>
              <div className="grid divide-y divide-border/70">
                {CI_OPTIONS.map(([option, description]) => (
                  <div key={option} className="grid gap-1 px-4 py-3 md:grid-cols-[260px_1fr] md:gap-5">
                    <code className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">{option}</code>
                    <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="overflow-hidden">
              <div className="border-b border-border/70 px-4 py-3 text-xs font-bold">Run options</div>
              <div className="grid divide-y divide-border/70">
                {OPTIONS.map(([option, description]) => (
                  <div key={option} className="grid gap-1 px-4 py-3 md:grid-cols-[220px_1fr] md:gap-5">
                    <code className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">{option}</code>
                    <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <Card className="p-5">
            <h2 className="text-sm font-bold">Exit codes</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ExitCode value="0" label="All selected requests passed" tone="text-emerald-500" />
              <ExitCode value="1" label="HTTP, transport, or assertion failure" tone="text-red-500" />
              <ExitCode value="2" label="Invalid project, scope, environment, or arguments" tone="text-amber-500" />
              <ExitCode value="130" label="Run interrupted from the terminal" tone="text-cyan-500" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function quote(value: string): string {
  if (!value) return 'beacon'
  return /\s/.test(value) ? `"${value}"` : value
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = async (value: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopied(false), 1400)
    } catch {
      toast.error('Failed to copy')
    }
  }
  return { copied, copy }
}

function CopyCommand({ value, placeholder, compact = false }: { value: string; placeholder?: string; compact?: boolean }) {
  const { copied, copy } = useCopy()
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-slate-950 px-3 py-2 text-slate-100">
      <code className={`min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{value || placeholder}</code>
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-slate-300 hover:bg-white/10 hover:text-white" disabled={!value} onClick={() => copy(value)}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
}

function CopyBlock({ value }: { value: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 pr-10 font-mono text-[10px] leading-relaxed text-slate-200">{value}</pre>
      <Button variant="ghost" size="icon" className="absolute right-2 top-2 h-7 w-7 text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => copy(value)}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
}

function ExitCode({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className={`font-mono text-xl font-bold ${tone}`}>{value}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
