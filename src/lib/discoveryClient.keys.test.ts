import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * After Phase 1, key selection happens server-side in api/apify.ts.
 * These tests verify that the discovery pipeline calls startRun (the proxy endpoint)
 * and completes with an empty client key pool.
 */
const startRunCalls: Array<{ actorId: string; apiKey: string }> = []
vi.mock('./apifyCore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./apifyCore')>()
  return {
    ...actual,
    startRun: vi.fn(async (actorId: string, _input: unknown, apiKey: string) => {
      startRunCalls.push({ actorId, apiKey })
      return { runId: 'r', datasetId: 'd' }
    }),
    pollRun: vi.fn(async () => 'd'),
    fetchDataset: vi.fn(async () => []),
  }
})

import { runLocationDiscovery } from './discoveryClient'

beforeEach(() => {
  startRunCalls.length = 0
})

describe('runLocationDiscovery — proxy transport', () => {
  it('calls startRun with an empty client key pool (proxy selects keys server-side)', async () => {
    await runLocationDiscovery(['nyc food'], 'New York', [])
    expect(startRunCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('passes the actor id to startRun (proxy validates it against the allowlist)', async () => {
    await runLocationDiscovery(['la food'], 'Los Angeles', [])
    expect(startRunCalls[0].actorId).toMatch(/instagram/)
  })

  it('works for successive location searches with an empty key pool', async () => {
    await runLocationDiscovery(['nyc food'], 'New York', [])
    await runLocationDiscovery(['la food'], 'Los Angeles', [])
    expect(startRunCalls).toHaveLength(2)
  })
})
