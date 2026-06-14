/**
 * Unit tests for hashtagGenerator — excludeHashtags parameter coverage.
 *
 * The excludeHashtags param sanitizes each entry (.replace(/[^\w]/g, '').slice(0, 30))
 * before injecting into the Gemini prompt. This is tested via:
 *
 *   1. generateHashtags() with empty key + excludeHashtags → rule fallback, no crash
 *   2. generateHashtags() with empty key + undefined excludeHashtags → same rule fallback
 *   3. generateHashtags() with empty city/niche → rule fallback regardless of excludeHashtags
 *
 * The Gemini-path exclusion clause (fetch-dependent) is tested with vi.stubGlobal for fetch.
 *
 * Covers:
 *   A. Rule-fallback path: excludeHashtags param is silently ignored (not applicable to rule-based)
 *   B. Gemini path: fetch called with prompt containing exclusion clause when excludeHashtags is set
 *   C. Gemini path: no exclusion clause injected when excludeHashtags is empty
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateHashtags } from './hashtagGenerator'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── Rule-fallback path (Gemini call fails) ────────────────────────────────────
// Phase 1: the guard on client-side key presence is gone — the proxy is always
// attempted. Rule fallback is triggered when the proxy returns a non-auth error.

describe('generateHashtags — excludeHashtags with rule fallback (Gemini unavailable)', () => {
  it('returns rule-based hashtags without crashing when excludeHashtags is provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('proxy error')))
    const result = await generateHashtags('', 'Mumbai', 'food', 'standard', undefined, ['MumbaiFood', 'MumbaiFoodie'])
    expect(result.fromAI).toBe(false)
    expect(result.hashtags.length).toBeGreaterThan(0)
  })

  it('returns rule-based hashtags without crashing when excludeHashtags is empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('proxy error')))
    const result = await generateHashtags('', 'Mumbai', 'food', 'standard', undefined, [])
    expect(result.fromAI).toBe(false)
    expect(result.hashtags.length).toBeGreaterThan(0)
  })

  it('returns rule-based hashtags without crashing when excludeHashtags is undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('proxy error')))
    const result = await generateHashtags('', 'Mumbai', 'food', 'standard', undefined, undefined)
    expect(result.fromAI).toBe(false)
    expect(result.hashtags.length).toBeGreaterThan(0)
  })
})

// ── Gemini path: exclusion clause injection (fetch mocked) ───────────────────

describe('generateHashtags — excludeHashtags with Gemini path', () => {
  it('includes exclusion clause in prompt body when excludeHashtags has entries', async () => {
    let capturedBody: string | null = null

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = opts.body as string
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: '["MumbaiStreetFood", "MumbaiFoodVlogger"]' }],
                },
              },
            ],
          }),
        }
      }),
    )

    await generateHashtags('fake-key-123', 'Mumbai', 'food', 'standard', undefined, ['MumbaiFood', 'MumbaiFoodie'])

    expect(capturedBody).not.toBeNull()
    const parsed = JSON.parse(capturedBody!)
    // Phase 1: geminiGenerate posts { model, body: { contents, ... } } to /api/gemini
    const promptText: string = (parsed.body ?? parsed).contents[0].parts[0].text
    // The exclusion clause should appear in the prompt
    expect(promptText).toContain('Do NOT repeat any of these hashtags')
    expect(promptText).toContain('MumbaiFood')
  })

  it('sanitizes excludeHashtags entries: strips non-word chars', async () => {
    let capturedBody: string | null = null

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = opts.body as string
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: '["MumbaiEats"]' }],
                },
              },
            ],
          }),
        }
      }),
    )

    // Pass hashtags with special chars that should be stripped
    await generateHashtags('fake-key-123', 'Mumbai', 'food', 'standard', undefined, ['#Mumbai!Food', '@MumbaiFoodie$'])

    expect(capturedBody).not.toBeNull()
    const parsed = JSON.parse(capturedBody!)
    // Phase 1: geminiGenerate posts { model, body: { contents, ... } } to /api/gemini
    const promptText: string = (parsed.body ?? parsed).contents[0].parts[0].text
    // Special chars stripped: '#Mumbai!Food' → 'MumbaiFood', '@MumbaiFoodie$' → 'MumbaiFoodie'
    // The exclusion clause should contain the sanitized values without special chars.
    // Check the exclusion clause specifically (it appears after "already tried): ")
    const exclusionClause = promptText.match(/already tried\):\s*([^\n.]+)/)?.[1] ?? ''
    expect(exclusionClause).toContain('MumbaiFood')
    expect(exclusionClause).toContain('MumbaiFoodie')
    expect(exclusionClause).not.toContain('#')
    expect(exclusionClause).not.toContain('!')
    expect(exclusionClause).not.toContain('@')
    expect(exclusionClause).not.toContain('$')
  })

  it('does NOT include exclusion clause when excludeHashtags is empty', async () => {
    let capturedBody: string | null = null

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = opts.body as string
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: '["MumbaiFood"]' }],
                },
              },
            ],
          }),
        }
      }),
    )

    await generateHashtags('fake-key-123', 'Mumbai', 'food', 'standard', undefined, [])

    expect(capturedBody).not.toBeNull()
    const parsed = JSON.parse(capturedBody!)
    // Phase 1: geminiGenerate posts { model, body: { contents, ... } } to /api/gemini
    const promptText: string = (parsed.body ?? parsed).contents[0].parts[0].text
    expect(promptText).not.toContain('Do NOT repeat')
  })

  it('does NOT include exclusion clause when excludeHashtags is undefined', async () => {
    let capturedBody: string | null = null

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = opts.body as string
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: '["MumbaiFood"]' }],
                },
              },
            ],
          }),
        }
      }),
    )

    await generateHashtags('fake-key-123', 'Mumbai', 'food', 'standard', undefined, undefined)

    expect(capturedBody).not.toBeNull()
    const parsed = JSON.parse(capturedBody!)
    // Phase 1: geminiGenerate posts { model, body: { contents, ... } } to /api/gemini
    const promptText: string = (parsed.body ?? parsed).contents[0].parts[0].text
    expect(promptText).not.toContain('Do NOT repeat')
  })
})
