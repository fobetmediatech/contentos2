/**
 * Tests for parseDiscoveryOutput — the JSON parser for Gemini's discovery response.
 *
 * parseDiscoveryOutput is a private function, so we test it via analyzeDiscovery
 * with a mocked fetch that returns controlled raw JSON strings.
 *
 * Covers:
 *   - Valid discovery output: results stored, niche preserved
 *   - Null coercions: specialties→[], contentFocus→'', rationale→''
 *   - rank coercion: null/string → Number()
 *   - Missing results array → GeminiError('PARSE_ERROR')
 *   - Invalid JSON → GeminiError('PARSE_ERROR')
 *   - Empty candidates → GeminiError('SAFETY_BLOCK')
 *   - Markdown code fence stripping (```json ... ```)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { analyzeDiscovery, GeminiError } from './gemini'

// ----- Helpers -----

function makeGeminiResponse(text: string, finishReason = 'STOP') {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason,
      },
    ],
  }
}

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      ok,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const VALID_OUTPUT = JSON.stringify({
  niche: 'food bloggers',
  results: [
    {
      username: 'chef_mumbai',
      category: 'top',
      rank: 1,
      rationale: 'Top creator',
      specialties: ['indian food'],
      contentFocus: 'restaurant reviews',
      partnershipReady: true,
      locationConfidence: 'confirmed',
    },
  ],
})

describe('analyzeDiscovery / parseDiscoveryOutput — valid output', () => {
  it('returns parsed results and niche', async () => {
    mockFetch(makeGeminiResponse(VALID_OUTPUT))
    const out = await analyzeDiscovery('key', 'Mumbai', 'food', [])
    expect(out.niche).toBe('food bloggers')
    expect(out.results).toHaveLength(1)
    expect(out.results[0].username).toBe('chef_mumbai')
  })

  it('preserves specialties array', async () => {
    mockFetch(makeGeminiResponse(VALID_OUTPUT))
    const out = await analyzeDiscovery('key', 'Mumbai', 'food', [])
    expect(out.results[0].specialties).toEqual(['indian food'])
  })

  it('strips markdown code fences from the response', async () => {
    const fenced = '```json\n' + VALID_OUTPUT + '\n```'
    mockFetch(makeGeminiResponse(fenced))
    const out = await analyzeDiscovery('key', 'Mumbai', 'food', [])
    expect(out.results[0].username).toBe('chef_mumbai')
  })
})

describe('analyzeDiscovery / parseDiscoveryOutput — null coercions', () => {
  it('coerces null specialties to empty array', async () => {
    const json = JSON.stringify({
      niche: 'food',
      results: [
        {
          username: 'user1',
          category: 'top',
          rank: 1,
          rationale: 'Good',
          specialties: null,
          contentFocus: 'reviews',
          partnershipReady: true,
          locationConfidence: 'likely',
        },
      ],
    })
    mockFetch(makeGeminiResponse(json))
    const out = await analyzeDiscovery('key', 'Mumbai', 'food', [])
    expect(out.results[0].specialties).toEqual([])
  })

  it('coerces null contentFocus to empty string', async () => {
    const json = JSON.stringify({
      niche: 'food',
      results: [
        {
          username: 'user1',
          category: 'top',
          rank: 1,
          rationale: 'Good',
          specialties: ['food'],
          contentFocus: null,
          partnershipReady: false,
          locationConfidence: 'unknown',
        },
      ],
    })
    mockFetch(makeGeminiResponse(json))
    const out = await analyzeDiscovery('key', 'Mumbai', 'food', [])
    expect(out.results[0].contentFocus).toBe('')
  })

  it('coerces null rationale to empty string', async () => {
    const json = JSON.stringify({
      niche: 'food',
      results: [
        {
          username: 'user1',
          category: 'trending',
          rank: 2,
          rationale: null,
          specialties: [],
          contentFocus: 'food',
          partnershipReady: false,
          locationConfidence: 'unknown',
        },
      ],
    })
    mockFetch(makeGeminiResponse(json))
    const out = await analyzeDiscovery('key', 'Mumbai', 'food', [])
    expect(out.results[0].rationale).toBe('')
  })

  it('coerces null rank to 0 via Number()', async () => {
    const json = JSON.stringify({
      niche: 'food',
      results: [
        {
          username: 'user1',
          category: 'top',
          rank: null,
          rationale: 'Good',
          specialties: [],
          contentFocus: 'food',
          partnershipReady: true,
          locationConfidence: 'confirmed',
        },
      ],
    })
    mockFetch(makeGeminiResponse(json))
    const out = await analyzeDiscovery('key', 'Mumbai', 'food', [])
    expect(out.results[0].rank).toBe(0)
  })
})

describe('analyzeDiscovery / parseDiscoveryOutput — error paths', () => {
  it('throws PARSE_ERROR when results array is missing', async () => {
    const json = JSON.stringify({ niche: 'food' }) // no results field
    mockFetch(makeGeminiResponse(json))
    await expect(analyzeDiscovery('key', 'Mumbai', 'food', [])).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    })
  })

  it('throws PARSE_ERROR when response is invalid JSON', async () => {
    mockFetch(makeGeminiResponse('not json at all'))
    await expect(analyzeDiscovery('key', 'Mumbai', 'food', [])).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    })
  })

  it('throws SAFETY_BLOCK when candidates array is empty', async () => {
    mockFetch({ candidates: [] })
    await expect(analyzeDiscovery('key', 'Mumbai', 'food', [])).rejects.toMatchObject({
      code: 'SAFETY_BLOCK',
    })
  })

  it('throws SAFETY_BLOCK when candidate text is empty string', async () => {
    mockFetch(makeGeminiResponse(''))
    await expect(analyzeDiscovery('key', 'Mumbai', 'food', [])).rejects.toMatchObject({
      code: 'SAFETY_BLOCK',
    })
  })

  it('throws PARSE_ERROR when finishReason is MAX_TOKENS', async () => {
    mockFetch(makeGeminiResponse(VALID_OUTPUT, 'MAX_TOKENS'))
    await expect(analyzeDiscovery('key', 'Mumbai', 'food', [])).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    })
  })

  it('throws RATE_LIMITED on 429 response', async () => {
    // callGeminiWithSchema retries 3 times on 429 (exponential backoff 1s+2s+4s).
    // Use fake timers so the sleeps resolve instantly; mock fetch persistently so
    // all 4 calls (original + 3 retries) see a 429.
    vi.useFakeTimers()
    const rateLimitedResponse = {
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }),
      text: () => Promise.resolve(''),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rateLimitedResponse))

    // Attach rejection handler BEFORE runAllTimersAsync to prevent the
    // "unhandled rejection" warning that Node emits when a promise rejects
    // between the setTimeout resolution and our await.
    const promise = analyzeDiscovery('key', 'Mumbai', 'food', [])
    promise.catch(() => { /* handled below */ })

    await vi.runAllTimersAsync()
    await expect(promise).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    vi.useRealTimers()
  })

  it('throws INVALID_PROMPT on 400 response', async () => {
    mockFetch({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad prompt' } }, false, 400)
    await expect(analyzeDiscovery('key', 'Mumbai', 'food', [])).rejects.toMatchObject({
      code: 'INVALID_PROMPT',
    })
  })

  it('thrown errors are instances of GeminiError', async () => {
    mockFetch({ candidates: [] })
    await expect(analyzeDiscovery('key', 'Mumbai', 'food', [])).rejects.toBeInstanceOf(GeminiError)
  })
})

describe('analyzeDiscovery — thought parts are filtered', () => {
  it('ignores parts with thought:true and only uses the actual text part', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'I am thinking...', thought: true },
                    { text: VALID_OUTPUT },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
      }),
    )
    const out = await analyzeDiscovery('key', 'Mumbai', 'food', [])
    expect(out.results[0].username).toBe('chef_mumbai')
  })
})
