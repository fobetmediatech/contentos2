/**
 * Regression tests for intentParser — niche is optional when handles are named.
 *
 * Caught by the intent golden eval (real Gemini) but reproduced here DETERMINISTICALLY
 * (mocked fetch, no key) so normal `npm run test` protects it:
 *
 * The Phase-1a prompt change ("resolve when @handles are named") stopped forcing a
 * best-guess niche, so Gemini correctly omits `niche` for handle-driven requests
 * ("compare @a and @b", "break down @x's reels"). The schema previously REQUIRED
 * niche (z.string().min(1)) and rejected those — two retries then PARSE_ERROR.
 *
 * Fix: niche optional + a refine enforcing niche-OR-handles (a resolved intent must
 * have something to act on).
 *
 * All tests mock global fetch — no real network calls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseIntent } from './intentParser'
import { GeminiError } from './gemini'

function makeOkResponse(body: unknown) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason: 'STOP' }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('intentParser — niche optional when handles are named', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('resolves a handle-driven COMPETITOR request with no niche (eval-caught regression)', async () => {
    // The exact shape Gemini returned for "compare @zomato and @swiggyindia".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      needsClarification: false,
      knownHandles: ['zomato', 'swiggyindia'],
      pipelineType: 'competitor',
      routingConfidence: 'high',
    })))

    const intent = await parseIntent('key', 'compare @zomato and @swiggyindia')

    expect('needsClarification' in intent && intent.needsClarification === true).toBe(false)
    const resolved = intent as Extract<typeof intent, { needsClarification?: false | null | undefined }>
    expect(resolved.knownHandles).toContain('zomato')
    expect(resolved.pipelineType).toBe('competitor')
    expect(resolved.niche).toBe('') // no niche → empty string, not a validation failure
  })

  it('resolves a handle-driven REEL request with no niche', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      needsClarification: false,
      knownHandles: ['beerbiceps'],
      pipelineType: 'reel',
      routingConfidence: 'high',
    })))

    const intent = await parseIntent('key', 'break down @beerbiceps reel hooks')

    const resolved = intent as Extract<typeof intent, { needsClarification?: false | null | undefined }>
    expect(resolved.pipelineType).toBe('reel')
    expect(resolved.knownHandles).toContain('beerbiceps')
  })

  it('rejects a resolved intent with NEITHER niche nor handles (refine guard)', async () => {
    // Resolved but empty — nothing to act on. The refine must reject it (→ retry → PARSE_ERROR)
    // rather than letting an actionless intent through to dispatch.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      needsClarification: false,
      knownHandles: [],
      pipelineType: 'competitor',
      routingConfidence: 'high',
    })))

    await expect(parseIntent('key', 'do the thing')).rejects.toBeInstanceOf(GeminiError)
  })

  it('resolves a CONTENT intent with no niche and no handles (eval-caught: how-to questions)', async () => {
    // "how do I make my reels blow up in India" → content, no creator to find.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      needsClarification: false,
      location: 'India',
      pipelineType: 'content',
      routingConfidence: 'high',
    })))

    const intent = await parseIntent('key', 'how do I make my reels blow up in India')

    const resolved = intent as Extract<typeof intent, { needsClarification?: false | null | undefined }>
    expect(resolved.pipelineType).toBe('content')
  })

  it('resolves a REEL intent with no handles (the orchestrator asks for handles later)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      needsClarification: false,
      knownHandles: [],
      pipelineType: 'reel',
      routingConfidence: 'high',
    })))

    const intent = await parseIntent('key', 'break down some reel hooks')

    const resolved = intent as Extract<typeof intent, { needsClarification?: false | null | undefined }>
    expect(resolved.pipelineType).toBe('reel')
  })
})
