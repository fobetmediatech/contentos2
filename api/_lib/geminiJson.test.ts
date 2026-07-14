import { describe, it, expect, vi, afterEach } from 'vitest'
import { geminiGenerateJson, GeminiJsonError, pickGeminiKey } from './geminiJson'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, status, text: async () => JSON.stringify(body),
  } as Response)
}

describe('geminiGenerateJson', () => {
  it('parses the model text as JSON', async () => {
    mockFetchOnce({ candidates: [{ content: { parts: [{ text: '{"foo":"bar"}' }] } }] })
    const result = await geminiGenerateJson('prompt', {}, 'k')
    expect(result).toEqual({ foo: 'bar' })
  })

  it('throws GeminiJsonError on a non-ok response', async () => {
    mockFetchOnce({}, false, 503)
    await expect(geminiGenerateJson('prompt', {}, 'k')).rejects.toBeInstanceOf(GeminiJsonError)
  })

  it('carries the HTTP status on the non-ok error', async () => {
    mockFetchOnce({}, false, 503)
    await expect(geminiGenerateJson('prompt', {}, 'k')).rejects.toMatchObject({ status: 503 })
  })

  it('throws GeminiJsonError when candidates/parts are empty (no content guard)', async () => {
    mockFetchOnce({ candidates: [] })
    await expect(geminiGenerateJson('prompt', {}, 'k')).rejects.toBeInstanceOf(GeminiJsonError)
  })

  it('throws a labeled GeminiJsonError (not a raw SyntaxError) when the model text is malformed JSON', async () => {
    mockFetchOnce({ candidates: [{ content: { parts: [{ text: 'not valid json{' }] } }] })
    const promise = geminiGenerateJson('prompt', {}, 'k')
    await expect(promise).rejects.toBeInstanceOf(GeminiJsonError)
    await expect(promise).rejects.toMatchObject({ message: 'Gemini returned malformed JSON' })
  })
})

// Regression: GEMINI_API_KEY/GEMINI_KEYS may be a comma-separated POOL; verify the
// merge/trim/random-pick behavior (mirrors api/analyze-reel-video.test.ts's pickGeminiKey suite).
describe('pickGeminiKey', () => {
  it('returns a SINGLE member of a comma-separated GEMINI_API_KEY pool', () => {
    process.env.GEMINI_API_KEY = 'k1,k2,k3'
    delete process.env.GEMINI_KEYS
    for (let i = 0; i < 25; i++) expect(['k1', 'k2', 'k3']).toContain(pickGeminiKey())
  })

  it('merges GEMINI_KEYS, trims, and drops blanks', () => {
    process.env.GEMINI_API_KEY = 'a, b ,'
    process.env.GEMINI_KEYS = 'c'
    const seen = new Set(Array.from({ length: 40 }, () => pickGeminiKey()))
    expect([...seen].sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns empty string when no keys are configured', () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_KEYS
    expect(pickGeminiKey()).toBe('')
  })
})
