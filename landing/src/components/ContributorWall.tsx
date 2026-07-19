import { useEffect, useState } from 'react'
import { ArrowUpRight, Github } from 'lucide-react'
import {
  fetchGitHubContributors,
  readContributorCache,
  writeContributorCache,
  type Contributor,
} from '../lib/githubContributors'

const CONTRIBUTORS_URL = 'https://github.com/nannndev/beacon/graphs/contributors'

export type ContributorWallState =
  | { status: 'loading' }
  | { status: 'ready'; contributors: Contributor[] }
  | { status: 'error' }

interface ContributorWallViewProps {
  state: ContributorWallState
}

export function ContributorWallView({ state }: ContributorWallViewProps) {
  if (state.status === 'loading') {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading GitHub contributors</span>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="h-24 animate-pulse rounded-2xl border border-border/70 bg-muted/40"
            />
          ))}
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-card/55 p-8 text-center">
        <Github className="mx-auto h-6 w-6 text-cyan-500" aria-hidden="true" />
        <h3 className="mt-3 text-lg font-semibold">Profiles are taking a break</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
          GitHub may be offline or rate limited. The contributor history is still available
          directly in the repository.
        </p>
        <a
          href={CONTRIBUTORS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-500 hover:text-cyan-400"
        >
          View contributors on GitHub <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    )
  }

  if (state.contributors.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-cyan-500/30 bg-cyan-500/5 p-8 text-center">
        <h3 className="text-lg font-semibold">You could be the next contributor</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a contribution track above and help shape Beacon.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {state.contributors.map((contributor) => (
        <a
          key={contributor.login}
          href={contributor.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-card/70 p-3 transition-all hover:-translate-y-0.5 hover:border-cyan-500/40 hover:shadow-lg"
        >
          <img
            src={contributor.avatarUrl}
            alt={contributor.login + ' GitHub avatar'}
            width="48"
            height="48"
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-12 w-12 shrink-0 rounded-xl bg-muted object-cover"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold group-hover:text-cyan-500">
              @{contributor.login}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {contributor.contributions}{' '}
              {contributor.contributions === 1 ? 'contribution' : 'contributions'}
            </span>
          </span>
        </a>
      ))}
    </div>
  )
}

export function ContributorWall() {
  const [state, setState] = useState<ContributorWallState>({ status: 'loading' })

  useEffect(() => {
    const cached = readContributorCache(window.sessionStorage)
    if (cached) {
      setState({ status: 'ready', contributors: cached })
      return
    }

    const controller = new AbortController()
    fetchGitHubContributors(controller.signal)
      .then((contributors) => {
        writeContributorCache(window.sessionStorage, contributors)
        setState({ status: 'ready', contributors })
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setState({ status: 'error' })
      })

    return () => controller.abort()
  }, [])

  return <ContributorWallView state={state} />
}
