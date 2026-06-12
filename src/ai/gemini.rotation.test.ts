/**
 * Tests for Gemini key rotation helpers (server-side after Phase 1) and
 * the geminiGenerate proxy transport.
 *
 * After Phase 1, geminiGenerate routes all calls through /api/gemini; key
 * rotation and 429 failover now happen server-side in api/gemini.ts.
 * The geminiKeyRotator module still exists (used by the proxy) so its unit
 * tests remain here for that module's own correctness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { geminiGenerate } from './gemini'
import { pickGeminiKey, markGeminiKeyCooldown, hasFreshGeminiKey } from '../lib/geminiKeyRotator'
import storage from '../lib/storage'

beforeEach(() => {
  storage.set('gemini_key_cooldowns', '{}')
  storage.set('gemini_key_rotation_idx', '0')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

// ----- geminiKeyRotator (module-level correctness) -----

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

// ----- geminiGenerate — proxy transport -----

describe('geminiGenerate — proxy transport', () => {
  it('posts to /api/gemini with model and request body', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ok } = await geminiGenerate([], { contents: [{ parts: [{ text: 'hello' }] }] })

    expect(ok).toBe(true)
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/gemini')
    expect(options.method).toBe('POST')
    const body = JSON.parse(options.body as string)
    expect(body.model).toBeTruthy()
    expect(body.body).toEqual({ contents: [{ parts: [{ text: 'hello' }] }] })
  })

  it('returns ok:false with the proxy error for non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { code: 401, message: 'no token', status: 'UNAUTHENTICATED' } }),
    }))

    const { ok, status, json } = await geminiGenerate([], { contents: [] })

    expect(ok).toBe(false)
    expect(status).toBe(401)
    expect(json.error?.status).toBe('UNAUTHENTICATED')
  })

  it('returns a fallback error json when the proxy response is not parseable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.reject(new Error('not json')),
    }))

    const { ok, status } = await geminiGenerate([], { contents: [] })

    expect(ok).toBe(false)
    expect(status).toBe(503)
  })

  it('ignores the apiKeys argument (proxy selects keys server-side)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await geminiGenerate(['key-that-should-be-ignored'], { contents: [] })

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    // The request body must NOT contain the apiKey — it goes only to the proxy
    const body = JSON.parse(options.body as string)
    expect(JSON.stringify(body)).not.toContain('key-that-should-be-ignored')
  })
})
