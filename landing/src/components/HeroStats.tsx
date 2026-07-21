import { useEffect, useState } from 'react'
import { Download, Star } from 'lucide-react'
import { CountUp } from './motion'
import { fetchGitHubStats, type GitHubStats } from '../lib/githubStats'

const GITHUB_URL = 'https://github.com/nannndev/beacon'

/** Live social proof under the hero CTA: total release downloads + GitHub
 *  stars. A metric only appears once it has something to show — no "0 stars"
 *  while the project is young — and the whole strip stays hidden until then. */
export function HeroStats() {
  const [stats, setStats] = useState<GitHubStats | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchGitHubStats(controller.signal).then(setStats).catch(() => {})
    return () => controller.abort()
  }, [])

  const downloads = stats?.downloads ?? 0
  const stars = stats?.stars ?? 0
  if (downloads <= 0 && stars <= 0) return null

  return (
    <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
      {downloads > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Download className="h-4 w-4 text-cyan-400" />
          <span className="font-bold tabular-nums text-foreground"><CountUp value={downloads} durationMs={900} /></span>
          download{downloads === 1 ? '' : 's'}
        </span>
      )}
      {stars > 0 && (
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <Star className="h-4 w-4 text-amber-400" />
          <span className="font-bold tabular-nums text-foreground"><CountUp value={stars} durationMs={900} /></span>
          on GitHub
        </a>
      )}
    </div>
  )
}
