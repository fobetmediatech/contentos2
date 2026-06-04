/**
 * Tests for withKeyFailover — the per-run key failover that makes a pool of N Apify keys
 * actually resilient. When a key is out of budget (402 → QUOTA_EXCEEDED) or rate-limited
 * (429 → RATE_LIMITED), the run rolls over to the next available key instead of failing the
 * whole scrape. Non-key errors are rethrown immediately (no pointless retry).
 *
 * The callback receives the chosen key and stands in for the real startRun→pollRun→fetchDataset
 * lifecycle, so we exercise the failover loop directly without mocking fetch.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { withKeyFailover, ApifyError } from './apifyCore'
import storage from './storage'

beforeEach(() => {
  // Reset rotation index + cooldown map (in-memory storage adapter under Node) between tests.
  storage.set('apify_key_cooldowns', '{}')
  storage.set('apify_key_rotation_idx', '0')
})

describe('withKeyFailover', () => {
  it('rolls over to another key when the first is out of credit (402 → QUOTA_EXCEEDED)', async () => {
    let attempts = 0
    const result = await withKeyFailover(['k1', 'k2', 'k3'], async (apiKey) => {
      attempts++
      if (attempts === 1) throw new ApifyError('QUOTA_EXCEEDED', 'out of credit', 402)
      return `ok:${apiKey}`
    })
    expect(attempts).toBe(2) // retried after the first key 402'd
    expect(result).toMatch(/^ok:/)
  })

  it('rolls over on RATE_LIMITED as well', async () => {
    let attempts = 0
    const result = await withKeyFailover(['k1', 'k2'], async () => {
      attempts++
      if (attempts === 1) throw new ApifyError('RATE_LIMITED', 'rate limited', 429)
      return 'done'
    })
    expect(attempts).toBe(2)
    expect(result).toBe('done')
  })

  it('does NOT retry on a non-key error (RUN_FAILED) — rethrows immediately', async () => {
    let attempts = 0
    await expect(
      withKeyFailover(['k1', 'k2'], async () => {
        attempts++
        throw new ApifyError('RUN_FAILED', 'actor blew up', 0)
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' })
    expect(attempts).toBe(1) // one attempt, no failover
  })

  it('throws once every key has been tried and exhausted', async () => {
    let attempts = 0
    await expect(
      withKeyFailover(['k1', 'k2'], async () => {
        attempts++
        throw new ApifyError('QUOTA_EXCEEDED', 'out of credit', 402)
      }),
    ).rejects.toBeInstanceOf(ApifyError)
    expect(attempts).toBe(2) // one attempt per key (maxAttempts = key count)
  })

  it('succeeds on the first try without wasting attempts when the key works', async () => {
    let attempts = 0
    const result = await withKeyFailover(['k1', 'k2'], async () => {
      attempts++
      return 'first-try'
    })
    expect(attempts).toBe(1)
    expect(result).toBe('first-try')
  })
})
