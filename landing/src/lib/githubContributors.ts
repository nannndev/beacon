export interface Contributor {
  login: string
  profileUrl: string
  avatarUrl: string
  contributions: number
}

export interface StorageReader {
  getItem(key: string): string | null
}

export interface StorageWriter {
  setItem(key: string, value: string): void
}

interface ContributorCache {
  savedAt: number
  contributors: Contributor[]
}

export const CONTRIBUTOR_CACHE_KEY = 'beacon:github-contributors:v1'
export const CONTRIBUTOR_CACHE_TTL_MS = 30 * 60 * 1_000
const CONTRIBUTORS_URL =
  'https://api.github.com/repos/nannndev/beacon/contributors?per_page=100'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toContributor(value: unknown): Contributor | null {
  if (!isRecord(value)) return null
  if (value.type !== 'User') return null
  if (
    typeof value.login !== 'string' ||
    typeof value.html_url !== 'string' ||
    typeof value.avatar_url !== 'string' ||
    typeof value.contributions !== 'number' ||
    value.contributions <= 0 ||
    value.login.toLowerCase().endsWith('[bot]')
  ) {
    return null
  }

  return {
    login: value.login,
    profileUrl: value.html_url,
    avatarUrl: value.avatar_url,
    contributions: value.contributions,
  }
}

function isContributor(value: unknown): value is Contributor {
  if (!isRecord(value)) return false
  return (
    typeof value.login === 'string' &&
    typeof value.profileUrl === 'string' &&
    typeof value.avatarUrl === 'string' &&
    typeof value.contributions === 'number' &&
    value.contributions > 0
  )
}

export function normalizeContributors(input: unknown, limit = 100): Contributor[] {
  if (!Array.isArray(input)) return []

  return input
    .map(toContributor)
    .filter((item): item is Contributor => item !== null)
    .sort((left, right) => right.contributions - left.contributions)
    .slice(0, limit)
}

export function readContributorCache(
  storage: StorageReader,
  now = Date.now(),
): Contributor[] | null {
  try {
    const raw = storage.getItem(CONTRIBUTOR_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.contributors)) return null
    if (now - parsed.savedAt >= CONTRIBUTOR_CACHE_TTL_MS) return null
    if (!parsed.contributors.every(isContributor)) return null
    return parsed.contributors
  } catch {
    return null
  }
}

export function writeContributorCache(
  storage: StorageWriter,
  contributors: Contributor[],
  now = Date.now(),
) {
  try {
    const cache: ContributorCache = { savedAt: now, contributors }
    storage.setItem(CONTRIBUTOR_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // The contributor wall remains useful when storage is unavailable.
  }
}

export async function fetchGitHubContributors(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Contributor[]> {
  const response = await fetcher(CONTRIBUTORS_URL, {
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error('GitHub contributors request failed with ' + response.status)
  }

  return normalizeContributors(await response.json())
}
