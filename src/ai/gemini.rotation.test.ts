/**
 * Tests for Gemini key rotation + 429 failover (the multi-user resilience fix).
 *
 * - geminiKeyRotator: round-robin, cooldown skip, exhaustion signal.
 * - geminiGenerate: on a 429 it cools the key and rolls over to a fresh one; when EVERY key is
 *   429'd it throws RATE_LIMITED. This is what stops one shared key from rate-limiting the team.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { geminiGenerate } from './gemini'
import { pickGeminiKey, markGeminiKeyCooldown, hasFreshGeminiKey } from '../lib/geminiKeyRotator'
import storage from '../lib/storage'

beforeEach(() => {
  // Reset the gemini rotator's cooldown map + round-robin index (in-memory storage under Node).
  storage.set('gemini_key_cooldowns', '{}')
  storage.set('gemini_key_rotation_idx', '0')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const rateLimited = () => ({
  ok: false,
  status: 429,
  json: () => Promise.resolve({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }),
  headers: { get: () => null },
})
const success = () => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }),
  headers: { get: () => null },
})

describe('geminiKeyRotator', () => {
  it('round-robins across available keys (does not always pick the same one)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) seen.add(pickGeminiKey(['ka', 'kb', 'kc'])!.key)
    expect(seen.size).toBeGreaterThan(1)
  })

  it('skips a cooled key, and signals exhaustion when every key is cooling down', () => {
    markGeminiKeyCooldown('ka')
    expect(hasFreshGeminiKey(['ka'])).toBe(false)
    expect(hasFreshGeminiKey(['ka', 'kb'])).toBe(true) // kb still fresh
    const only = pickGeminiKey(['ka'])! // the only key is cooled → returned anyway, flagged exhausted
    expect(only.key).toBe('ka')
    expect(only.exhausted).toBe(true)
  })

  it('returns null for an empty pool', () => {
    expect(pickGeminiKey([])).toBeNull()
  })
})

describe('geminiGenerate — 429 failover across the key pool', () => {
  it('rolls over to a DIFFERENT key on 429 and succeeds', async () => {
    const keysSeen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        const key = (init.headers as Record<string, string>)['x-goog-api-key']
        keysSeen.push(key)
        return Promise.resolve(keysSeen.length === 1 ? rateLimited() : success())
      }),
    )
    const { ok } = await geminiGenerate(['ka', 'kb'], { contents: [] })
    expect(ok).toBe(true)
    expect(keysSeen).toHaveLength(2) // one 429, then a retry
    expect(keysSeen[0]).not.toBe(keysSeen[1]) // failed over to the OTHER key, not the limited one
  })

  it('throws RATE_LIMITED when every key is rate-limited', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(rateLimited())))
    const p = geminiGenerate(['ka', 'kb'], { contents: [] })
    p.catch(() => { /* asserted below */ })
    await vi.runAllTimersAsync()
    await expect(p).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    vi.useRealTimers()
  })
})
