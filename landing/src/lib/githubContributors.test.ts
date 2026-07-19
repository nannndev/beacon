import { describe, expect, it, vi } from 'vitest'
import {
  CONTRIBUTOR_CACHE_KEY,
  CONTRIBUTOR_CACHE_TTL_MS,
  fetchGitHubContributors,
  normalizeContributors,
  readContributorCache,
  writeContributorCache,
  type Contributor,
} from './githubContributors'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    raw(key: string) {
      return values.get(key)
    },
  }
}

const ada: Contributor = {
  login: 'ada',
  profileUrl: 'https://github.com/ada',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  contributions: 12,
}

describe('normalizeContributors', () => {
  it('keeps valid users, removes bots and malformed records, and sorts by contribution count', () => {
    const result = normalizeContributors([
      {
        login: 'grace',
        html_url: 'https://github.com/grace',
        avatar_url: 'https://avatars.githubusercontent.com/u/2',
        contributions: 4,
        type: 'User',
      },
      {
        login: 'release[bot]',
        html_url: 'https://github.com/apps/release',
        avatar_url: 'https://avatars.githubusercontent.com/u/3',
        contributions: 99,
        type: 'Bot',
      },
      {
        login: 'ada',
        html_url: 'https://github.com/ada',
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
        contributions: 12,
        type: 'User',
      },
      { login: 'missing-urls', contributions: 3, type: 'User' },
    ])

    expect(result.map((item) => item.login)).toEqual(['ada', 'grace'])
  })

  it('returns an empty list for non-array API data', () => {
    expect(normalizeContributors({ message: 'rate limited' })).toEqual([])
  })
})

describe('contributor cache', () => {
  it('round-trips fresh data and expires it after thirty minutes', () => {
    const storage = memoryStorage()
    writeContributorCache(storage, [ada], 1_000)

    expect(readContributorCache(storage, 1_000 + CONTRIBUTOR_CACHE_TTL_MS - 1)).toEqual([ada])
    expect(readContributorCache(storage, 1_000 + CONTRIBUTOR_CACHE_TTL_MS)).toBeNull()
    expect(storage.raw(CONTRIBUTOR_CACHE_KEY)).toContain('"login":"ada"')
  })

  it('ignores invalid JSON and invalid cached contributor records', () => {
    const broken = { getItem: () => '{broken' }
    const malformed = {
      getItem: () => JSON.stringify({ savedAt: 10, contributors: [{ login: 'only-login' }] }),
    }

    expect(readContributorCache(broken, 20)).toBeNull()
    expect(readContributorCache(malformed, 20)).toBeNull()
  })

  it('keeps rendered data usable when browser storage rejects a write', () => {
    const unavailable = {
      setItem() {
        throw new Error('storage unavailable')
      },
    }
    expect(() => writeContributorCache(unavailable, [ada], 20)).not.toThrow()
  })
})

describe('fetchGitHubContributors', () => {
  it('requests the public repository endpoint and returns normalized users', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            login: 'ada',
            html_url: 'https://github.com/ada',
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
            contributions: 12,
            type: 'User',
          },
        ]),
        { status: 200 },
      ),
    )

    await expect(fetchGitHubContributors(undefined, fetcher)).resolves.toEqual([ada])
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/nannndev/beacon/contributors?per_page=100',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it('rejects failed GitHub responses', async () => {
    const fetcher = vi.fn(async () => new Response('rate limited', { status: 403 }))
    await expect(fetchGitHubContributors(undefined, fetcher)).rejects.toThrow(
      'GitHub contributors request failed with 403',
    )
  })
})
