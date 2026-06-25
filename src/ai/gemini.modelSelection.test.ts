/**
 * Tests for the per-call model split: geminiGenerate / callGeminiWithSchema must thread a
 * caller-supplied `model` into the /api/gemini proxy request body, and default to the standard
 * model when none is given. This guards the "premium model on ranking + seed only" wiring — if the
 * threading regresses, the proxy would silently fall back to the default model for every call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { geminiGenerate, callGeminiWithSchema } from './gemini'

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }] }),
    text: () => Promise.resolve(''),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Pull the JSON body of the first fetch call to the proxy. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): { model?: string } {
  return JSON.parse(fetchMock.mock.calls[0][1].body)
}

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('per-call model selection', () => {
  it('geminiGenerate forwards an explicit model into the proxy body', async () => {
    const fetchMock = stubFetch()
    await geminiGenerate('key', { contents: [] }, undefined, 'gemini-3.5-flash')
    expect(sentBody(fetchMock).model).toBe('gemini-3.5-flash')
  })

  it('geminiGenerate defaults to the standard model when none is passed', async () => {
    const fetchMock = stubFetch()
    await geminiGenerate('key', { contents: [] })
    // Unset env → default 'gemini-2.5-flash'.
    expect(sentBody(fetchMock).model).toBe('gemini-2.5-flash')
  })

  it('callGeminiWithSchema forwards its model option to the proxy body', async () => {
    const fetchMock = stubFetch()
    await callGeminiWithSchema('key', 'prompt', { type: 'object' }, { model: 'gemini-3.5-flash' })
    expect(sentBody(fetchMock).model).toBe('gemini-3.5-flash')
  })

  it('callGeminiWithSchema defaults to the standard model when no model option is given', async () => {
    const fetchMock = stubFetch()
    await callGeminiWithSchema('key', 'prompt', { type: 'object' })
    expect(sentBody(fetchMock).model).toBe('gemini-2.5-flash')
  })
})
