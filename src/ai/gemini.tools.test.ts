/**
 * Tests for callGeminiWithTools — the Phase-1b function-calling primitive.
 *
 * The primitive is transport: it sends the conversation + tool declarations and
 * returns a discriminated result — the model either CALLS a tool or REPLIES with
 * text. Arg validation + repair live in the agent loop (T8), not here.
 *
 * All tests mock global fetch — no real network calls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { callGeminiWithTools, type GeminiFunctionDeclaration, type GeminiTurn } from './gemini'

function makeResponse(parts: unknown[], finishReason = 'STOP') {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts }, finishReason }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
function makeError(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const TOOLS: GeminiFunctionDeclaration[] = [
  { name: 'discover_competitors', description: 'find competitors', parameters: { type: 'object', properties: { niche: { type: 'string' } } } },
  { name: 'ask_clarification', description: 'ask the user', parameters: { type: 'object', properties: { question: { type: 'string' } } } },
]
const CONTENTS: GeminiTurn[] = [{ role: 'user', parts: [{ text: 'top fitness creators' }] }]

afterEach(() => { vi.unstubAllGlobals() })

describe('callGeminiWithTools — function-calling primitive', () => {
  it('parses a functionCall part → {kind:"call"}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse([
      { functionCall: { name: 'discover_competitors', args: { niche: 'fitness' } } },
    ])))
    const r = await callGeminiWithTools('key', CONTENTS, TOOLS)
    expect(r).toEqual({ kind: 'call', name: 'discover_competitors', args: { niche: 'fitness' } })
  })

  it('returns text when the model replies instead of calling → {kind:"text"}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse([{ text: 'Which kind of fitness?' }])))
    const r = await callGeminiWithTools('key', CONTENTS, TOOLS)
    expect(r).toEqual({ kind: 'text', text: 'Which kind of fitness?' })
  })

  it('filters thought parts out of the text reply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse([
      { text: 'internal reasoning', thought: true },
      { text: 'Which city?' },
    ])))
    const r = await callGeminiWithTools('key', CONTENTS, TOOLS)
    expect(r).toEqual({ kind: 'text', text: 'Which city?' })
  })

  it('prefers a tool call over text when both parts are present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse([
      { text: 'let me search' },
      { functionCall: { name: 'discover_competitors', args: {} } },
    ])))
    const r = await callGeminiWithTools('key', CONTENTS, TOOLS)
    expect(r.kind).toBe('call')
    if (r.kind === 'call') expect(r.name).toBe('discover_competitors')
  })

  it('defaults missing args to {}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse([{ functionCall: { name: 'ask_clarification' } }])))
    const r = await callGeminiWithTools('key', CONTENTS, TOOLS)
    expect(r).toEqual({ kind: 'call', name: 'ask_clarification', args: {} })
  })

  it('maps a 401 to GeminiError AUTH_ERROR (shared mapGeminiHttpError)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeError(401, {
      error: { code: 401, status: 'UNAUTHENTICATED', message: 'API key invalid' },
    })))
    await expect(callGeminiWithTools('key', CONTENTS, TOOLS)).rejects.toMatchObject({ code: 'AUTH_ERROR' })
  })

  it('throws SAFETY_BLOCK on empty candidates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))
    await expect(callGeminiWithTools('key', CONTENTS, TOOLS)).rejects.toMatchObject({ code: 'SAFETY_BLOCK' })
  })

  it('throws retryable PARSE_ERROR only after exhausting malformed-call retries', async () => {
    // Persistent malform on every attempt → after retries are spent, surface a retryable
    // parse error (not SAFETY_BLOCK). 1 initial + 2 retries = 3 fetches.
    // Fresh Response per call — a Response body can only be read once, and the retry reuses fetch.
    const fetchMock = vi.fn().mockImplementation(() => makeResponse([], 'MALFORMED_FUNCTION_CALL'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callGeminiWithTools('key', CONTENTS, TOOLS)).rejects.toMatchObject({ code: 'PARSE_ERROR', retryable: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries on MALFORMED_FUNCTION_CALL and recovers when a later attempt succeeds', async () => {
    // The intermittent hiccup: first attempt malforms, retry returns a clean tool call.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse([], 'MALFORMED_FUNCTION_CALL'))
      .mockResolvedValueOnce(makeResponse([{ functionCall: { name: 'discover_competitors', args: { niche: 'fitness' } } }]))
    vi.stubGlobal('fetch', fetchMock)
    const r = await callGeminiWithTools('key', CONTENTS, TOOLS)
    expect(r).toEqual({ kind: 'call', name: 'discover_competitors', args: { niche: 'fitness' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('drops the thinking budget on the retry after a malformed call', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse([], 'MALFORMED_FUNCTION_CALL'))
      .mockResolvedValueOnce(makeResponse([{ text: 'ok' }]))
    vi.stubGlobal('fetch', fetchMock)
    await callGeminiWithTools('key', CONTENTS, TOOLS, { thinkingBudget: 512 })
    const env0 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    const env1 = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    const gc0 = (env0.body ?? env0).generationConfig
    const gc1 = (env1.body ?? env1).generationConfig
    expect(gc0.thinkingConfig).toEqual({ thinkingBudget: 512 }) // first attempt keeps thinking
    expect(gc1.thinkingConfig).toBeUndefined() // retry drops it
  })

  it('sends functionDeclarations + systemInstruction in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse([{ text: 'ok' }]))
    vi.stubGlobal('fetch', fetchMock)
    await callGeminiWithTools('key', CONTENTS, TOOLS, { systemInstruction: 'be helpful' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const envelope = JSON.parse(init.body as string)
    // Phase 1: callGeminiWithTools posts to /api/gemini with { model, body: { ... } }
    const body = envelope.body ?? envelope
    expect(body.tools[0].functionDeclarations).toHaveLength(2)
    expect(body.tools[0].functionDeclarations[0].name).toBe('discover_competitors')
    expect(body.systemInstruction.parts[0].text).toBe('be helpful')
  })
})
