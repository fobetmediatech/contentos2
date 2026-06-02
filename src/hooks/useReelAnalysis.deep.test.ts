// @vitest-environment jsdom
/**
 * Orchestration test for useReelAnalysis.startDeepReport (T10).
 *
 * Verifies the R2 contract — the run NEVER blocks on a single reel failing/skipping —
 * by mocking the three pipeline deps (scrapeTopReels, scrapeReelVideos, analyzeReelDeep)
 * and asserting on the real zustand store after the run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// Everything referenced inside a vi.mock factory must be created via vi.hoisted()
// (factories hoist above module-level declarations) — including the error class.
const mocks = vi.hoisted(() => {
  class NoReelsErrorMock extends Error {}
  return {
    scrapeTopReels: vi.fn(),
    scrapeReelVideos: vi.fn(),
    analyzeReelDeep: vi.fn(),
    getCachedDeep: vi.fn(),
    setCachedDeep: vi.fn(),
    NoReelsErrorMock,
  }
})

vi.mock('../lib/reelScraper', () => ({ scrapeTopReels: mocks.scrapeTopReels, NoReelsError: mocks.NoReelsErrorMock }))
vi.mock('../lib/reelVideoClient', () => ({ scrapeReelVideos: mocks.scrapeReelVideos }))
vi.mock('../lib/deepReelCache', () => ({ getCachedDeep: mocks.getCachedDeep, setCachedDeep: mocks.setCachedDeep }))
// startDeepReport calls analyzeReelDeep + the report builders from reelAnalyzer; stub
// them all so the real module (and its Gemini client import) never loads in the test.
// The report step runs after creators finish — stubbed to a no-op so the per-creator
// status assertions are what's under test (report rendering is covered elsewhere).
vi.mock('../lib/reelAnalyzer', () => ({
  analyzeReel: vi.fn(),
  analyzeReelDeep: mocks.analyzeReelDeep,
  synthesizeNiche: vi.fn(),
  buildPerCreatorSummary: vi.fn(),
  computeBenchmarks: vi.fn(),
  buildDeepPlaybook: vi.fn(() => ({
    handle: '',
    reelCount: 0,
    archetypeDistribution: [],
    dominantArchetype: '',
    avgHookScore: 0,
    medianViews: 0,
    consistencyScore: 0,
    signatureTemplate: '',
    topExemplar: null,
  })),
  buildDeepReportTable: vi.fn(() => ({ archetypeDistribution: [], comparison: [], topExemplars: [] })),
  synthesizeDeepReport: vi.fn(async () => ({ whoIsWinning: '', nicheFormula: '', gaps: [], replicate: [], avoid: [], test: [] })),
}))

import { useReelAnalysis } from './useReelAnalysis'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import type { ReelData, StoredDeepReelAnalysis } from '../store/reelAnalysisStore'

const reel = (sc: string): ReelData => ({
  shortCode: sc,
  url: `https://www.instagram.com/reel/${sc}/`,
  displayUrl: '',
  videoViewCount: 1000,
  likesCount: 100,
  commentsCount: 10,
  videoDuration: 20,
  caption: '',
  hashtags: [],
})

const deepResult = (): StoredDeepReelAnalysis => ({
  hookArchetype: 'Curiosity gap',
  spokenHookVerbatim: 'hi',
  onScreenTextHook: '',
  visualOpening: 'x',
  hookBreakdown: 'y',
  pacingEditing: 'p',
  audioStrategy: 'a',
  retentionMechanism: 'r',
  psychologyTrigger: 'pt',
  ctaType: 'none',
  ctaPlacement: 'none',
  replicationTemplate: 't',
  whatToReplicate: 'w',
  whatToAvoid: 'av',
  hookScore: 7,
  commentsLikesRatio: 0.1,
})

beforeEach(() => {
  vi.clearAllMocks()
  useReelAnalysisStore.getState().reset()
  // Default: cache miss (clearAllMocks keeps implementations, so re-establish each test).
  mocks.getCachedDeep.mockResolvedValue(undefined)
  mocks.setCachedDeep.mockResolvedValue(undefined)
})
afterEach(cleanup)

const run = async (handles: string[]) => {
  const { result } = renderHook(() => useReelAnalysis())
  await act(async () => {
    await result.current.startDeepReport(handles)
  })
  return useReelAnalysisStore.getState().creatorStates
}

describe('useReelAnalysis.startDeepReport — R2 partial-failure', () => {
  it('happy: every reel analyzed -> creator done, all deepStatus done', async () => {
    mocks.scrapeTopReels.mockResolvedValue([reel('a'), reel('b')])
    mocks.scrapeReelVideos.mockResolvedValue(new Map([['a', 'urlA'], ['b', 'urlB']]))
    mocks.analyzeReelDeep.mockResolvedValue(deepResult())

    const states = await run(['nike'])
    expect(states.nike.status).toBe('done')
    expect(states.nike.deepStatus).toEqual({ a: 'done', b: 'done' })
    expect(Object.keys(states.nike.deepAnalyses ?? {})).toHaveLength(2)
  })

  it('partial: a reel with no video is skipped, the run still completes', async () => {
    mocks.scrapeTopReels.mockResolvedValue([reel('a'), reel('b')])
    mocks.scrapeReelVideos.mockResolvedValue(new Map([['a', 'urlA']])) // b has no video
    mocks.analyzeReelDeep.mockResolvedValue(deepResult())

    const states = await run(['nike'])
    expect(states.nike.status).toBe('done')
    expect(states.nike.deepStatus).toEqual({ a: 'done', b: 'skipped' })
    expect(mocks.analyzeReelDeep).toHaveBeenCalledOnce() // only the reel WITH a video
  })

  it('all reels fail analysis -> all failed, but the run still completes', async () => {
    mocks.scrapeTopReels.mockResolvedValue([reel('a'), reel('b')])
    mocks.scrapeReelVideos.mockResolvedValue(new Map([['a', 'urlA'], ['b', 'urlB']]))
    mocks.analyzeReelDeep.mockRejectedValue(new Error('fn 500'))

    const states = await run(['nike'])
    expect(states.nike.status).toBe('done')
    expect(states.nike.deepStatus).toEqual({ a: 'failed', b: 'failed' })
  })

  it('blocked video scrape -> creator failed (others would continue)', async () => {
    mocks.scrapeTopReels.mockResolvedValue([reel('a')])
    mocks.scrapeReelVideos.mockRejectedValue(new Error('IG blocked'))

    const states = await run(['nike'])
    expect(states.nike.status).toBe('failed')
  })

  it('no reels -> no-reels status', async () => {
    mocks.scrapeTopReels.mockRejectedValue(new mocks.NoReelsErrorMock('none'))

    const states = await run(['nike'])
    expect(states.nike.status).toBe('no-reels')
  })

  it('cache hit: restores from cache, skips the video scrape AND the analysis (R3 free re-run)', async () => {
    mocks.scrapeTopReels.mockResolvedValue([reel('a')])
    mocks.getCachedDeep.mockResolvedValue(deepResult()) // cached

    const states = await run(['nike'])
    expect(states.nike.status).toBe('done')
    expect(states.nike.deepStatus).toEqual({ a: 'done' })
    expect(mocks.scrapeReelVideos).not.toHaveBeenCalled()
    expect(mocks.analyzeReelDeep).not.toHaveBeenCalled()
  })
})
