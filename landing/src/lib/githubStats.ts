// Beacon GitHub stats (total release downloads + stars) for the landing page.
// Prefers the cached /api/stats serverless endpoint; falls back to hitting
// GitHub directly (handy in `vite dev`, where no function is running) and
// memoizes in localStorage so repeat views don't refetch.
export interface GitHubStats {
  downloads: number | null
  stars: number | null
}

const REPO = 'nannndev/beacon'
export const STATS_CACHE_KEY = 'beacon:github-stats:v1'
export const STATS_CACHE_TTL_MS = 30 * 60 * 1_000

interface StatsCache {
  savedAt: number
  stats: GitHubStats
}

function readCache(): GitHubStats | null {
  try {
    const raw = localStorage.getItem(STATS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StatsCache
    if (parsed && typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt < STATS_CACHE_TTL_MS && parsed.stats) {
      return parsed.stats
    }
  } catch {
    /* ignore */
  }
  return null
}

function writeCache(stats: GitHubStats): void {
  try {
    localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), stats } satisfies StatsCache))
  } catch {
    /* ignore */
  }
}

async function fromEndpoint(signal?: AbortSignal): Promise<GitHubStats | null> {
  try {
    const res = await fetch('/api/stats', { signal })
    if (!res.ok) return null
    const data = await res.json()
    if (data && (typeof data.downloads === 'number' || typeof data.stars === 'number')) {
      return { downloads: data.downloads ?? null, stars: data.stars ?? null }
    }
  } catch {
    /* ignore — fall through to direct GitHub */
  }
  return null
}

async function fromGitHub(signal?: AbortSignal): Promise<GitHubStats | null> {
  try {
    const [repo, releases] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}`, { signal }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { signal }).then((r) => (r.ok ? r.json() : null)),
    ])
    const stars = typeof repo?.stargazers_count === 'number' ? repo.stargazers_count : null
    const downloads = Array.isArray(releases)
      ? releases.reduce(
          (sum: number, rel: any) =>
            sum + (Array.isArray(rel.assets) ? rel.assets.reduce((a: number, x: any) => a + (x.download_count || 0), 0) : 0),
          0,
        )
      : null
    if (stars === null && downloads === null) return null
    return { downloads, stars }
  } catch {
    return null
  }
}

export async function fetchGitHubStats(signal?: AbortSignal): Promise<GitHubStats | null> {
  const cached = readCache()
  if (cached) return cached
  const stats = (await fromEndpoint(signal)) || (await fromGitHub(signal))
  if (stats) writeCache(stats)
  return stats
}
