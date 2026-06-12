import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * After Phase 1, key selection happens server-side in api/apify.ts.
 * These tests verify that the competitor pipeline correctly calls startRun
 * (the proxy endpoint) and completes successfully with an empty client key pool.
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

import { scrapeHashtagUsernames } from './apifyClient'

beforeEach(() => {
  startRunCalls.length = 0
})

describe('scrapeHashtagUsernames — proxy transport', () => {
  it('calls startRun for each hashtag batch even with an empty client key pool', async () => {
    await scrapeHashtagUsernames(['food'], [])  // empty keys — proxy holds them
    expect(startRunCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('passes the actor id to startRun (proxy validates it against the allowlist)', async () => {
    await scrapeHashtagUsernames(['travel'], [])
    expect(startRunCalls[0].actorId).toMatch(/instagram/)
  })

  it('works for successive runs with an empty key pool', async () => {
    await scrapeHashtagUsernames(['food'], [])
    await scrapeHashtagUsernames(['travel'], [])
    expect(startRunCalls).toHaveLength(2)
  })
})
