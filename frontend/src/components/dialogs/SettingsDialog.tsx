import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import {
  Palette, Bell, DownloadCloud, Plug, Info, Sun, Moon, Monitor,
  Loader2, CheckCircle2, ExternalLink, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isDesktop } from '../../lib/platform'
import { getThemePref, applyThemePref, subscribeTheme, type ThemePref } from '../../lib/theme'
import { getNotifyRunFinished, setNotifyRunFinished } from '../../lib/prefs'
import { useUpdater } from '../../hooks/useUpdater'
import { useAppVersion } from '../../hooks/useAppVersion'
import { BrandMark } from '../BrandMark'

const LINKS = {
  docs: 'https://nannndev.github.io/beacon/',
  discord: 'https://discord.gg/vRn4vw3Qf3',
  github: 'https://github.com/nannndev/beacon',
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenMcp: () => void
}

type SectionId = 'appearance' | 'notifications' | 'updates' | 'integrations' | 'about'

const SECTIONS: { id: SectionId; label: string; icon: typeof Palette; desktopOnly?: boolean }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'updates', label: 'Updates', icon: DownloadCloud, desktopOnly: true },
  { id: 'integrations', label: 'Integrations', icon: Plug, desktopOnly: true },
  { id: 'about', label: 'About', icon: Info },
]

/** A compact iOS-style toggle (no Switch primitive in the UI kit). */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-cyan-500' : 'bg-muted-foreground/30',
      )}
    >
      <span className={cn(
        'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-4' : 'translate-x-0.5',
      )} />
    </button>
  )
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange, onOpenMcp }: Props) {
  const desktop = isDesktop()
  const sections = SECTIONS.filter((s) => !s.desktopOnly || desktop)
  const [active, setActive] = useState<SectionId>('appearance')
  const [theme, setTheme] = useState<ThemePref>(getThemePref)
  const [notify, setNotify] = useState<boolean>(getNotifyRunFinished)
  const version = useAppVersion()
  const updater = useUpdater()

  useEffect(() => subscribeTheme(setTheme), [])

  useEffect(() => {
    if (!open) return
    setTheme(getThemePref())
    setNotify(getNotifyRunFinished())
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[660px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex h-[440px]">
          {/* Left nav */}
          <nav className="w-[168px] shrink-0 border-r border-border bg-muted/30 p-2">
            <div className="px-2 py-2 text-sm font-semibold">Settings</div>
            <div className="mt-1 space-y-0.5">
              {sections.map((s) => {
                const Icon = s.icon
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                      active === s.id
                        ? 'bg-background font-medium text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-70" />
                    {s.label}
                  </button>
                )
              })}
            </div>
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {active === 'appearance' && (
              <Section title="Appearance">
                <Row title="Theme" desc="Choose how Beacon looks. System follows your OS.">
                  <div className="flex rounded-lg bg-muted/60 p-0.5">
                    {([
                      { value: 'light', icon: Sun },
                      { value: 'dark', icon: Moon },
                      { value: 'system', icon: Monitor },
                    ] as { value: ThemePref; icon: typeof Sun }[]).map(({ value, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => applyThemePref(value)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                          theme === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {value}
                      </button>
                    ))}
                  </div>
                </Row>
              </Section>
            )}

            {active === 'notifications' && (
              <Section title="Notifications">
                <Row
                  title="Notify when a run finishes"
                  desc={desktop
                    ? 'Show a native desktop notification when a load test completes.'
                    : 'Desktop-only — available in the Beacon desktop app.'}
                >
                  <Toggle
                    checked={notify}
                    onChange={(v) => { setNotify(v); setNotifyRunFinished(v) }}
                  />
                </Row>
                <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                  Want results posted to a channel? Set up a <span className="font-medium text-foreground">Discord webhook</span> per project in
                  {' '}<span className="font-medium text-foreground">Project Settings → Discord notifications</span>.
                </div>
              </Section>
            )}

            {active === 'updates' && (
              <Section title="Updates">
                <Row title="Current version" desc="Beacon checks for updates automatically on launch.">
                  <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{version ? `v${version}` : updater.currentVersion ? `v${updater.currentVersion}` : '—'}</span>
                </Row>
                <div className="mt-2">
                  {updater.status === 'available' && (
                    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
                      <div className="text-sm font-medium">Version {updater.version} is available</div>
                      <Button size="sm" className="mt-2 gap-1.5" onClick={() => updater.downloadAndInstall()}>
                        <DownloadCloud className="h-3.5 w-3.5" /> Download &amp; install
                      </Button>
                    </div>
                  )}
                  {updater.status === 'downloading' && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Downloading… {Math.round(updater.progress * 100)}%
                    </div>
                  )}
                  {updater.status === 'ready' && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <div className="text-sm font-medium">Update ready</div>
                      <Button size="sm" className="mt-2 gap-1.5" onClick={() => updater.restart()}>
                        <RefreshCw className="h-3.5 w-3.5" /> Restart to update
                      </Button>
                    </div>
                  )}
                  {(updater.status === 'idle' || updater.status === 'checking' || updater.status === 'error') && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="gap-1.5" disabled={updater.status === 'checking'} onClick={() => updater.check()}>
                        {updater.status === 'checking'
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                          : <><RefreshCw className="h-3.5 w-3.5" /> Check for updates</>}
                      </Button>
                      {updater.error === 'up-to-date' && (
                        <span className="flex items-center gap-1 text-xs text-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> You’re up to date</span>
                      )}
                      {updater.error === 'no-platform' && (
                        <span className="text-xs text-muted-foreground">No update published for this platform yet.</span>
                      )}
                      {updater.status === 'error' && updater.error !== 'up-to-date' && updater.error !== 'no-platform' && (
                        <span className="text-xs text-red-500">{updater.error}</span>
                      )}
                    </div>
                  )}
                </div>
              </Section>
            )}

            {active === 'integrations' && (
              <Section title="Integrations">
                <Row title="MCP Server" desc="Connect Claude, Cursor, Windsurf, and other AI agents to this workspace.">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { onOpenChange(false); onOpenMcp() }}>
                    <Plug className="h-3.5 w-3.5" /> Open
                  </Button>
                </Row>
              </Section>
            )}

            {active === 'about' && (
              <Section title="About">
                <div className="flex flex-col items-center py-3 text-center">
                  <BrandMark size="sm" />
                  <div className="mt-3 text-base font-semibold">Beacon</div>
                  <div className="text-xs text-muted-foreground">{version ? `Version ${version}` : 'API workspace & load testing'}</div>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <LinkButton href={LINKS.docs}>Docs</LinkButton>
                    <LinkButton href={LINKS.discord}>Discord</LinkButton>
                    <LinkButton href={LINKS.github}>GitHub</LinkButton>
                  </div>
                </div>
              </Section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 divide-y divide-border/60">{children}</div>
    </div>
  )
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
    >
      {children} <ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  )
}
