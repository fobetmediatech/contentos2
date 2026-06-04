import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Per-run key rotation (audit fix). The competitor pipeline used to lock ONE key for an
 * entire multi-round analysis; a single 429 then cooled the key the whole run depended on.
 * Each scrape RUN must now pull a fresh key from the array via pickRunKey/pickAvailableKey,
 * matching the reel pipeline. We mock the network trio and capture the key each run used.
 */
const startRunCalls: string[] = []
vi.mock('./apifyCore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./apifyCore')>()
  return {
    ...actual, // keep real pickRunKey, ApifyError, chunk
    startRun: vi.fn(async (_actor: string, _input: unknown, apiKey: string) => {
      startRunCalls.push(apiKey)
      return { runId: 'r', datasetId: 'd' }
    }),
    pollRun: vi.fn(async () => 'd'),
    fetchDataset: vi.fn(async () => []),
  }
})

import { scrapeHashtagUsernames } from './apifyClient'
import { ApifyError } from './apifyCore'
import { markKeyCooldown } from './keyRotator'
import storage from './storage'

beforeEach(() => {
  startRunCalls.length = 0
  storage.set('apify_key_cooldowns', '{}')
  storage.set('apify_key_rotation_idx', '0')
})

describe('scrapeHashtagUsernames — per-run key rotation', () => {
  it('uses a different Apify key on successive runs instead of locking one', async () => {
    const keys = ['k1', 'k2', 'k3']
    await scrapeHashtagUsernames(['food'], keys)
    await scrapeHashtagUsernames(['travel'], keys)
    expect(startRunCalls).toHaveLength(2)
    expect(startRunCalls[0]).not.toBe(startRunCalls[1]) // rotated, not reused
    startRunCalls.forEach((k) => expect(keys).toContain(k))
  })

  it('throws RATE_LIMITED (and never starts a run) when every key is on cooldown', async () => {
    const keys = ['k1', 'k2']
    keys.forEach(markKeyCooldown)
    await expect(scrapeHashtagUsernames(['food'], keys)).rejects.toBeInstanceOf(ApifyError)
    expect(startRunCalls).toHaveLength(0)
  })
})
