import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Per-run key rotation for the discovery pipeline (audit fix — parity with apifyClient).
 * runLocationDiscovery used to lock ONE key for the whole multi-run analysis; it now picks
 * a fresh key per scrape RUN via pickRunKey. We mock the network trio and capture the key
 * each run used. fetchDataset returns [] so the hashtag scrape short-circuits after one run
 * (the per-run key pick we care about happens on that first run).
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

import { runLocationDiscovery } from './discoveryClient'
import { ApifyError } from './apifyCore'
import { markKeyCooldown } from './keyRotator'
import storage from './storage'

beforeEach(() => {
  startRunCalls.length = 0
  storage.set('apify_key_cooldowns', '{}')
  storage.set('apify_key_rotation_idx', '0')
})

describe('runLocationDiscovery — per-run key rotation', () => {
  it('uses a different Apify key on successive runs instead of locking one', async () => {
    const keys = ['k1', 'k2', 'k3']
    await runLocationDiscovery(['nyc food'], 'New York', keys)
    await runLocationDiscovery(['la food'], 'Los Angeles', keys)
    expect(startRunCalls).toHaveLength(2)
    expect(startRunCalls[0]).not.toBe(startRunCalls[1]) // rotated, not reused
    startRunCalls.forEach((k) => expect(keys).toContain(k))
  })

  it('throws RATE_LIMITED (and never starts a run) when every key is on cooldown', async () => {
    const keys = ['k1', 'k2']
    keys.forEach(markKeyCooldown)
    await expect(runLocationDiscovery(['nyc food'], 'New York', keys)).rejects.toBeInstanceOf(ApifyError)
    expect(startRunCalls).toHaveLength(0)
  })
})
