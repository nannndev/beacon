// The truth behind the figure: Beacon's AI Gateway in "Ordered (#1→#2)" mode.
// Requests go to the first account that has quota; an account that answers 429
// is skipped until its window refills. Each account is a token bucket.
// Pure module: no DOM, so it runs the same on server, client and in tests.

export interface Account {
  label: string
  capacity: number // requests per window before the provider answers 429
  refill: number // tokens restored per second
}

// Three subscription accounts, as in the gateway screenshot (cx #1, cx #2, gh #1).
export const ACCOUNTS: Account[] = [
  { label: '#1', capacity: 6, refill: 0.9 },
  { label: '#2', capacity: 6, refill: 0.9 },
  { label: '#3', capacity: 6, refill: 0.9 },
]

export const ARRIVALS = 2.6 // requests per second the client sends

export interface State {
  tokens: number[] // tokens left in each bucket (capacity = full quota)
  clock: number // seconds since start
  next: number // time of the next request
  route: number // account the last request went to (−1 = rejected)
  served: number[] // requests each account served
  rejected: number
  failovers: number
}

export const initial = (): State => ({
  tokens: ACCOUNTS.map((a) => a.capacity),
  clock: 0,
  next: 0.4,
  route: 0,
  served: ACCOUNTS.map(() => 0),
  rejected: 0,
  failovers: 0,
})

/** The ordered strategy: the first account with a whole token left. */
export function pick(tokens: number[]): number {
  return tokens.findIndex((t) => t >= 1)
}

/** Advances by dt. Returns the account a request was sent to this step, if any. */
export function step(s: State, dt: number): number | null {
  s.clock += dt
  ACCOUNTS.forEach((a, i) => {
    s.tokens[i] = Math.min(a.capacity, s.tokens[i] + a.refill * dt)
  })
  if (s.clock < s.next) return null
  s.next += 1 / ARRIVALS
  const to = pick(s.tokens)
  if (to < 0) {
    s.rejected++
    s.route = -1
    return -1
  }
  if (to !== s.route && s.route >= 0 && to > s.route) s.failovers++
  s.route = to
  s.tokens[to] -= 1
  s.served[to]++
  return to
}

/** Share of the quota used, 0..1, which the bucket's piston shows. */
export const fillOf = (s: State, i: number) => 1 - s.tokens[i] / ACCOUNTS[i].capacity

export function readoutOf(s: State) {
  const where = s.route < 0 ? 'all busy · 429' : `→ account ${ACCOUNTS[s.route].label}`
  return `${where} · ${s.failovers} failover${s.failovers === 1 ? '' : 's'}`
}

// Steady state with these numbers: arrivals (2.6/s) exceed one account's refill
// (0.9/s), so #1 drains, then traffic spills to #2 and #3. Three accounts restore
// 2.7/s together, just above arrivals, so nothing is rejected once warmed up.
export const COMBINED_REFILL = ACCOUNTS.reduce((sum, a) => sum + a.refill, 0)
