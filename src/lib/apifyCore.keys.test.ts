import { describe, it, expect, beforeEach } from 'vitest'
import { pickRunKey, ApifyError } from './apifyCore'
import { markKeyCooldown } from './keyRotator'
import storage from './storage'

/**
 * pickRunKey is the per-run key selector for the competitor + discovery pipelines (audit fix:
 * those pipelines used to lock one key for an entire multi-round analysis). It wraps the
 * round-robin pickAvailableKey and throws a RATE_LIMITED ApifyError when nothing is available,
 * so every scrape RUN can grab a fresh account — matching the reel pipeline.
 */
beforeEach(() => {
  // Reset rotation index + cooldown map (in-memory storage adapter under Node) between tests.
  storage.set('apify_key_cooldowns', '{}')
  storage.set('apify_key_rotation_idx', '0')
})

describe('pickRunKey', () => {
  it('returns an available key from the array', () => {
    expect(['k1', 'k2']).toContain(pickRunKey(['k1', 'k2']))
  })

  it('throws a RATE_LIMITED ApifyError when every key is on cooldown', () => {
    markKeyCooldown('k1')
    markKeyCooldown('k2')
    let caught: unknown
    try { pickRunKey(['k1', 'k2']) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ApifyError)
    expect((caught as ApifyError).code).toBe('RATE_LIMITED')
  })

  it('throws RATE_LIMITED when the keys array is empty', () => {
    expect(() => pickRunKey([])).toThrow(ApifyError)
  })
})
