/**
 * Tests for synthesizeCreatorHooks — context-safe creator-hook synthesis.
 *
 * Strategy: mock the Gemini layer (../ai/gemini) so we control how many calls
 * happen and what each returns. We assert:
 *   (a) a small set (fits default budget) → exactly ONE Gemini call (map only).
 *   (b) a tiny opts.budget → multiple map calls + one reduce call.
 *   (c) benchmarks.medianViews is the code-computed median (NOT from the mock).
 *   (d) a map chunk whose call rejects is skipped, not fatal (others succeed).
 *   (e) returns null when every map call rejects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../ai/gemini', () => ({ callGeminiWithSchema: vi.fn() }))

import { callGeminiWithSchema } from '../ai/gemini'
import { synthesizeCreatorHooks } from './reelAnalyzer'
import type { ReelData } from '../store/reelAnalysisStore'
import type { SingleReelResult } from '../store/singleReelStore'

const mockGemini = vi.mocked(callGeminiWithSchema)

// ---- Fixtures -------------------------------------------------------------

function makeReel(shortCode: string, views: number, likes: number, comments: number): ReelData {
  return {
    shortCode,
    url: `https://instagram.com/reel/${shortCode}`,
    displayUrl: `https://example.com/${shortCode}.jpg`,
    videoViewCount: views,
    likesCount: likes,
    commentsCount: comments,
    videoDuration: 30,
    caption: `Caption for ${shortCode}`,
    hashtags: ['#test'],
  }
}

function makeCaseStudy(shortCode: string): SingleReelResult {
  return {
    markdown: `# Case study ${shortCode}`,
    transcript: `This is the spoken hook for ${shortCode}. Keep watching to find out.`,
    segments: [{ start: 0, text: `Opening line of ${shortCode}` }],
    videoAnalysis: {
      duration_s: 30,
      aspect_ratio: '9:16',
      dominant_framing: 'talking-head',
      cuts_count: 4,
      text_overlay_density: 'medium',
      captions_present: true,
      trending_audio_hint: 'original audio',
      t0_frame: 'face close-up',
      visual_beats: [],
      notable_moments: [],
    },
  }
}

// A valid map/reduce LLM payload (matches CreatorHookSummary minus code-computed fields).
function validRaw() {
  return {
    dominantHooks: [{ pattern: 'Curiosity gap', count: 3, example: 'You will not believe…' }],
    recurringOpenings: ['Most people get this wrong'],
    whatConsistentlyWorks: ['Strong first-line hook'],
    replicableTemplates: ['Most people think X, but actually Y'],
    narrative: 'This creator leans hard on curiosity gaps.',
  }
}

beforeEach(() => {
  mockGemini.mockReset()
})

describe('synthesizeCreatorHooks', () => {
  it('(a) small set fits default budget → exactly ONE Gemini call, parsed summary', async () => {
    mockGemini.mockResolvedValue(validRaw())

    const reels = [makeReel('aaa', 1000, 100, 10), makeReel('bbb', 2000, 200, 20)]
    const caseStudies = { aaa: makeCaseStudy('aaa'), bbb: makeCaseStudy('bbb') }

    const summary = await synthesizeCreatorHooks('@creator', caseStudies, reels, 'KEY')

    expect(summary).not.toBeNull()
    expect(mockGemini).toHaveBeenCalledTimes(1)
    expect(summary!.handle).toBe('@creator')
    expect(summary!.reelCount).toBe(2)
    expect(summary!.dominantHooks[0].pattern).toBe('Curiosity gap')
    expect(summary!.narrative).toContain('curiosity')
  })

  it('(b) tiny budget forces multiple chunks → multiple map calls + one reduce call', async () => {
    mockGemini.mockResolvedValue(validRaw())

    // 4 reels, tiny budget → each digest its own chunk → 4 map calls + 1 reduce = 5.
    const reels = [
      makeReel('aaa', 1000, 100, 10),
      makeReel('bbb', 2000, 200, 20),
      makeReel('ccc', 3000, 300, 30),
      makeReel('ddd', 4000, 400, 40),
    ]
    const caseStudies = {
      aaa: makeCaseStudy('aaa'),
      bbb: makeCaseStudy('bbb'),
      ccc: makeCaseStudy('ccc'),
      ddd: makeCaseStudy('ddd'),
    }

    const summary = await synthesizeCreatorHooks('@creator', caseStudies, reels, 'KEY', undefined, {
      budget: 1,
    })

    expect(summary).not.toBeNull()
    // 4 map + 1 reduce
    expect(mockGemini).toHaveBeenCalledTimes(5)
    expect(summary!.reelCount).toBe(4)
  })

  it('(c) benchmarks.medianViews is the code-computed median, not from the mock', async () => {
    // Mock returns benchmarks-looking garbage; code must ignore it.
    mockGemini.mockResolvedValue({ ...validRaw(), benchmarks: { medianViews: 99999 } })

    // views: 100, 300, 500 → median 300. likes: 10, 30, 50 → median 30.
    const reels = [makeReel('aaa', 100, 10, 1), makeReel('bbb', 300, 30, 3), makeReel('ccc', 500, 50, 5)]
    const caseStudies = { aaa: makeCaseStudy('aaa'), bbb: makeCaseStudy('bbb'), ccc: makeCaseStudy('ccc') }

    const summary = await synthesizeCreatorHooks('@creator', caseStudies, reels, 'KEY')

    expect(summary!.benchmarks.medianViews).toBe(300)
    expect(summary!.benchmarks.medianLikes).toBe(30)
  })

  it('(d) a map chunk that rejects is skipped, not fatal — others still summarized', async () => {
    // chunk 0 rejects, chunks 1..3 resolve. Then reduce resolves.
    let mapCall = 0
    mockGemini.mockImplementation(async (_keys, prompt: string) => {
      // Distinguish reduce by a marker in the reduce prompt.
      if (typeof prompt === 'string' && prompt.includes('REDUCE')) return validRaw()
      mapCall += 1
      if (mapCall === 1) throw new Error('chunk 0 failed')
      return validRaw()
    })

    const reels = [
      makeReel('aaa', 1000, 100, 10),
      makeReel('bbb', 2000, 200, 20),
      makeReel('ccc', 3000, 300, 30),
    ]
    const caseStudies = {
      aaa: makeCaseStudy('aaa'),
      bbb: makeCaseStudy('bbb'),
      ccc: makeCaseStudy('ccc'),
    }

    const summary = await synthesizeCreatorHooks('@creator', caseStudies, reels, 'KEY', undefined, {
      budget: 1,
    })

    expect(summary).not.toBeNull()
    expect(summary!.reelCount).toBe(3)
  })

  it('(e) returns null when every map call rejects', async () => {
    mockGemini.mockImplementation(async (_keys, prompt: string) => {
      if (typeof prompt === 'string' && prompt.includes('REDUCE')) return validRaw()
      throw new Error('map failed')
    })

    const reels = [
      makeReel('aaa', 1000, 100, 10),
      makeReel('bbb', 2000, 200, 20),
      makeReel('ccc', 3000, 300, 30),
    ]
    const caseStudies = {
      aaa: makeCaseStudy('aaa'),
      bbb: makeCaseStudy('bbb'),
      ccc: makeCaseStudy('ccc'),
    }

    const summary = await synthesizeCreatorHooks('@creator', caseStudies, reels, 'KEY', undefined, {
      budget: 1,
    })

    expect(summary).toBeNull()
  })

  it('returns null on abort signal', async () => {
    mockGemini.mockResolvedValue(validRaw())
    const controller = new AbortController()
    controller.abort()

    const reels = [makeReel('aaa', 1000, 100, 10)]
    const caseStudies = { aaa: makeCaseStudy('aaa') }

    const summary = await synthesizeCreatorHooks('@creator', caseStudies, reels, 'KEY', controller.signal)

    expect(summary).toBeNull()
  })

  it('returns null when there are no case studies for any reel', async () => {
    mockGemini.mockResolvedValue(validRaw())
    const reels = [makeReel('aaa', 1000, 100, 10)]
    const summary = await synthesizeCreatorHooks('@creator', {}, reels, 'KEY')
    expect(summary).toBeNull()
    expect(mockGemini).not.toHaveBeenCalled()
  })
})
