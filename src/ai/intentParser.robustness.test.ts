/**
 * Robustness tests for intentParser.ts fetch-layer behaviour.
 *
 * Covers the three guards added in the JSON-failure fix:
 *   1. responseSchema is sent in the request body
 *   2. thinkingConfig is included for 2.5-flash, excluded for other models
 *   3. finishReason MAX_TOKENS → PARSE_ERROR before JSON.parse runs
 *   4. SyntaxError from JSON.parse → GeminiError('PARSE_ERROR') after retries
 *
 * All tests mock global fetch — no real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseIntent } from './intentParser'
import { GeminiError } from './gemini'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown, finishReason = 'STOP') {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify(body) }] },
          finishReason,
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function makeOkResponseRaw(rawText: string, finishReason = 'STOP') {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: rawText }] },
          finishReason,
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

const VALID_INTENT = {
  needsClarification: false,
  niche: 'fitness creators',
  location: null,
  knownHandles: [],
  depth: 'standard',
  clientName: null,
  pipelineType: 'competitor',
  routingConfidence: 'high',
}

// ── 1. responseSchema is included in the request body ────────────────────────

describe('fetchIntent — responseSchema in request body', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(makeOkResponse(VALID_INTENT))))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends responseSchema with needsClarification required', async () => {
    await parseIntent('key', 'find fitness creators')

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    const schema = body.generationConfig?.responseSchema

    expect(schema).toBeDefined()
    expect(schema.required).toContain('needsClarification')
    expect(schema.properties).toHaveProperty('niche')
    expect(schema.properties).toHaveProperty('pipelineType')
    expect(schema.properties.pipelineType.enum).toEqual(['competitor', 'discovery', 'reel'])
  })
})

// ── 2. thinkingConfig is model-conditional ───────────────────────────────────

describe('fetchIntent — thinkingConfig', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('includes thinkingBudget: 0 when model contains "2.5"', async () => {
    // Default model is gemini-2.5-flash (contains "2.5")
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(makeOkResponse(VALID_INTENT))))
    await parseIntent('key', 'find fitness creators')

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    const thinkingCfg = body.generationConfig?.thinkingConfig

    // Only assert when we know the model is 2.5-based. In CI VITE_GEMINI_MODEL
    // may be unset, defaulting to gemini-2.5-flash — so thinkingConfig must be present.
    // If VITE_GEMINI_MODEL overrides to a non-2.5 model, this test is a no-op.
    const model: string = (import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-2.5-flash') as string
    if (model.includes('2.5')) {
      expect(thinkingCfg).toEqual({ thinkingBudget: 0 })
    } else {
      expect(thinkingCfg).toBeUndefined()
    }
  })
})

// ── 3. finishReason MAX_TOKENS → PARSE_ERROR ─────────────────────────────────

describe('fetchIntent — MAX_TOKENS finishReason', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('throws GeminiError PARSE_ERROR when finishReason is MAX_TOKENS', async () => {
    // Partial JSON — would cause SyntaxError if parsed, but MAX_TOKENS guard fires first
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(makeOkResponseRaw('{"needsClarification": false, "niche":', 'MAX_TOKENS')),
    ))

    await expect(parseIntent('key', 'find fitness creators')).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GeminiError &&
        err.code === 'PARSE_ERROR' &&
        err.message.includes('MAX_TOKENS'),
    )
  })

  it('does NOT throw on finishReason STOP with valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(makeOkResponse(VALID_INTENT, 'STOP'))))
    await expect(parseIntent('key', 'find fitness creators')).resolves.toMatchObject({
      niche: 'fitness creators',
    })
  })
})

// ── 4. SyntaxError → GeminiError PARSE_ERROR after all retries ───────────────

describe('callGeminiForIntent — JSON parse failure exhausts retries', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('throws GeminiError PARSE_ERROR (not SyntaxError) when JSON is malformed on all attempts', async () => {
    vi.useFakeTimers()
    // Return malformed JSON (unquoted key — the exact failure mode seen in production).
    // Use mockImplementation so each retry call gets a fresh Response — a single instance
    // can only be read once, and reusing it on retries would mask the SyntaxError.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(makeOkResponseRaw('{ needsClarification: false, niche: "fitness" }', 'STOP')),
    ))

    // Attach .catch BEFORE advancing timers so the rejection is always handled,
    // preventing Vitest from surfacing it as an unhandled error.
    const errPromise = parseIntent('key', 'find fitness creators').catch((e) => e)
    // Advance past all retry delays (2 × 1500ms) without real wall-clock wait
    await vi.runAllTimersAsync()
    const err = await errPromise

    vi.useRealTimers()

    expect(err).toBeInstanceOf(GeminiError)
    // After all retries: SyntaxError should be wrapped as PARSE_ERROR
    expect((err as GeminiError).code).toBe('PARSE_ERROR')
    // Should NOT surface as a 'Network error' which would mislead users
    expect((err as GeminiError).message).not.toContain('Network error')
  })
})
