import type { RunConfig } from '../types.ts'

export function buildLoadRunPayload(
  testId: string,
  cfg: RunConfig,
): Record<string, unknown> {
  return { test_id: testId, mode: 'load', ...cfg }
}
