// Vercel serverless function — cached GitHub download + star counts for Beacon.
//
// Fetching server-side keeps GitHub's unauthenticated 60-req/hr-per-IP limit off
// the visitor's browser, and the CDN cache header means GitHub is hit at most
// once an hour regardless of traffic. Set a GITHUB_TOKEN env var in the Vercel
// project to raise the upstream rate limit (optional; works without it).
//
// This file lives outside `src` so the Vite/tsc build never compiles it —
// Vercel builds functions with its own pipeline.
const REPO = 'nannndev/beacon'

export default async function handler(_req: any, res: any) {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'beacon-landing',
    }
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const [repoRes, releasesRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}`, { headers }),
      fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers }),
    ])
    if (!repoRes.ok || !releasesRes.ok) throw new Error('github upstream error')

    const repo: any = await repoRes.json()
    const releases: any = await releasesRes.json()

    const downloads = Array.isArray(releases)
      ? releases.reduce(
          (sum: number, r: any) =>
            sum +
            (Array.isArray(r.assets)
              ? r.assets.reduce((s: number, a: any) => s + (a.download_count || 0), 0)
              : 0),
          0,
        )
      : 0
    const stars = typeof repo?.stargazers_count === 'number' ? repo.stargazers_count : 0

    // Edge-cache for an hour; keep serving the stale value for a day while it
    // revalidates in the background, so a visitor never waits on GitHub.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({ downloads, stars })
  } catch (error: any) {
    // Never fail the page — the client hides the strip when values are null.
    res.status(200).json({ downloads: null, stars: null, error: String(error?.message || error) })
  }
}
