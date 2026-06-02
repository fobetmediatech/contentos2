/**
 * Unit tests for the /api/analyze-reel-video function.
 *
 * Strategy (per the eng-review test plan): mock the Gemini Files API client at the
 * module boundary (so no real Gemini calls) and stub global fetch for the video
 * download. Covers SSRF allowlist, content-type guard, fetch failure, the gate,
 * method/body validation, the happy path, and coercion (enum + score clamp).
 *
 * vi.mock factory vars use vi.hoisted() (prior learning: factories hoist above
 * module-level consts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const analyzeVideoMock = vi.hoisted(() => vi.fn())

vi.mock('./_lib/geminiFiles', () => ({
  analyzeVideoWithGemini: analyzeVideoMock,
  GeminiFilesError: class GeminiFilesError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
}))

import handler, { analyzeReelVideo, coerceDeepAnalysis, HandlerError } from './analyze-reel-video'

const APIFY_URL = 'https://api.apify.com/v2/key-value-stores/abc/records/DX_Video.mp4'

const GEMINI_DATA = {
  hookArchetype: 'Curiosity gap',
  spokenHookVerbatim: 'wait for it',
  onScreenTextHook: 'POV',
  visualOpening: 'a fast zoom onto a wall',
  hookBreakdown: 'opens mid-action',
  pacingEditing: 'fast cuts',
  audioStrategy: 'trending sound',
  retentionMechanism: 'open loop',
  psychologyTrigger: 'curiosity',
  ctaType: 'follow',
  ctaPlacement: 'end',
  replicationTemplate: 'Watch me [X]',
  whatToReplicate: 'the cold open',
  whatToAvoid: 'slow intro',
  hookScore: 8,
}

/** Build a fetch mock that returns a video Response (or a failure). */
function videoFetch(opts: { ok?: boolean; contentType?: string; bytes?: Uint8Array } = {}) {
  const { ok = true, contentType = 'video/mp4', bytes = new Uint8Array([1, 2, 3, 4]) } = opts
  return vi.fn(async () => new Response(ok ? bytes : null, { status: ok ? 200 : 500, headers: { 'content-type': contentType } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  analyzeVideoMock.mockResolvedValue({ data: GEMINI_DATA, usage: null })
  process.env.GEMINI_API_KEY = 'test-key'
  delete process.env.REEL_FN_SECRET
})
afterEach(() => {
  vi.unstubAllGlobals()
})

// --------------------------------------------------------------------------
describe('analyzeReelVideo core', () => {
  it('rejects a non-allowlisted host (SSRF guard) without fetching', async () => {
    const f = videoFetch()
    vi.stubGlobal('fetch', f)
    await expect(analyzeReelVideo({ downloadedVideoUrl: 'https://evil.example.com/x.mp4', shortCode: 'a' }, 'k')).rejects.toMatchObject({ status: 400 })
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects an invalid URL', async () => {
    vi.stubGlobal('fetch', videoFetch())
    await expect(analyzeReelVideo({ downloadedVideoUrl: 'not-a-url', shortCode: 'a' }, 'k')).rejects.toMatchObject({ status: 400 })
  })

  it('maps a failed video fetch to 502', async () => {
    vi.stubGlobal('fetch', videoFetch({ ok: false }))
    await expect(analyzeReelVideo({ downloadedVideoUrl: APIFY_URL, shortCode: 'a' }, 'k')).rejects.toMatchObject({ status: 502 })
  })

  it('rejects a non-video content-type (422)', async () => {
    vi.stubGlobal('fetch', videoFetch({ contentType: 'text/html' }))
    await expect(analyzeReelVideo({ downloadedVideoUrl: APIFY_URL, shortCode: 'a' }, 'k')).rejects.toMatchObject({ status: 422 })
  })

  it('rejects an empty body (502)', async () => {
    vi.stubGlobal('fetch', videoFetch({ bytes: new Uint8Array([]) }))
    await expect(analyzeReelVideo({ downloadedVideoUrl: APIFY_URL, shortCode: 'a' }, 'k')).rejects.toMatchObject({ status: 502 })
  })

  it('happy path returns a coerced DeepReelAnalysis', async () => {
    vi.stubGlobal('fetch', videoFetch())
    const out = await analyzeReelVideo({ downloadedVideoUrl: APIFY_URL, shortCode: 'a', caption: 'hi' }, 'k')
    expect(out.hookArchetype).toBe('Curiosity gap')
    expect(out.spokenHookVerbatim).toBe('wait for it')
    expect(out.hookScore).toBe(8)
    expect(analyzeVideoMock).toHaveBeenCalledOnce()
  })
})

// --------------------------------------------------------------------------
describe('coerceDeepAnalysis', () => {
  it('clamps hookScore to 1-10 and defaults a non-enum archetype', () => {
    const out = coerceDeepAnalysis({ ...GEMINI_DATA, hookArchetype: '', hookScore: 99 })
    expect(out.hookScore).toBe(10)
    expect(out.hookArchetype).toBe('Curiosity gap') // fallback when empty/non-enum
  })

  it('fills safe defaults for missing fields and never throws', () => {
    const out = coerceDeepAnalysis({})
    expect(out.ctaType).toBe('none')
    expect(out.hookScore).toBe(5)
    expect(typeof out.visualOpening).toBe('string')
  })
})

// --------------------------------------------------------------------------
describe('handler', () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://app.test/api/analyze-reel-video', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('405 on non-POST', async () => {
    const res = await handler(new Request('https://app.test/api/analyze-reel-video', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('403 when the shared secret is configured but missing/wrong', async () => {
    process.env.REEL_FN_SECRET = 'shh'
    vi.stubGlobal('fetch', videoFetch())
    const res = await handler(post({ downloadedVideoUrl: APIFY_URL, shortCode: 'a' }))
    expect(res.status).toBe(403)
  })

  it('400 on missing required fields', async () => {
    vi.stubGlobal('fetch', videoFetch())
    const res = await handler(post({ shortCode: 'a' }))
    expect(res.status).toBe(400)
  })

  it('500 when GEMINI_API_KEY is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    const res = await handler(post({ downloadedVideoUrl: APIFY_URL, shortCode: 'a' }))
    expect(res.status).toBe(500)
  })

  it('200 happy path returns shortCode + analysis', async () => {
    vi.stubGlobal('fetch', videoFetch())
    const res = await handler(post({ downloadedVideoUrl: APIFY_URL, shortCode: 'DX1', caption: 'hi' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { shortCode: string; analysis: { hookArchetype: string } }
    expect(body.shortCode).toBe('DX1')
    expect(body.analysis.hookArchetype).toBe('Curiosity gap')
  })

  it('maps a core HandlerError to its status', async () => {
    vi.stubGlobal('fetch', videoFetch())
    const res = await handler(post({ downloadedVideoUrl: 'https://evil.example.com/x.mp4', shortCode: 'a' }))
    expect(res.status).toBe(400)
    expect(HandlerError).toBeDefined()
  })
})
