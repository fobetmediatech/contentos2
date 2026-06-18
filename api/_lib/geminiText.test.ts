import { describe, it, expect, vi, afterEach } from 'vitest'
import { geminiGenerateMarkdown, GeminiTextError } from './geminiText'

afterEach(() => vi.restoreAllMocks())

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, status, text: async () => JSON.stringify(body),
  } as Response)
}

describe('geminiGenerateMarkdown', () => {
  it('returns the model text', async () => {
    mockFetchOnce({ candidates: [{ content: { parts: [{ text: '# Hello' }] } }] })
    const md = await geminiGenerateMarkdown({ systemPrompt: 'sys', userPayload: '{}', apiKey: 'k' })
    expect(md).toBe('# Hello')
  })
  it('throws GeminiTextError on a non-ok response', async () => {
    mockFetchOnce({}, false, 503)
    await expect(geminiGenerateMarkdown({ systemPrompt: 's', userPayload: '{}', apiKey: 'k' }))
      .rejects.toBeInstanceOf(GeminiTextError)
  })
  it('throws when the model returns empty content', async () => {
    mockFetchOnce({ candidates: [{ content: { parts: [{ text: '' }] } }] })
    await expect(geminiGenerateMarkdown({ systemPrompt: 's', userPayload: '{}', apiKey: 'k' }))
      .rejects.toBeInstanceOf(GeminiTextError)
  })
})
