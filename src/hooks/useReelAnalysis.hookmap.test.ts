// src/hooks/useReelAnalysis.hookmap.test.ts (@vitest-environment jsdom)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../lib/reelScraper', () => ({
  scrapeTopReels: vi.fn(async () => ([
    { shortCode: 'r1', url: 'u1', displayUrl: '', videoViewCount: 10, likesCount: 1, commentsCount: 1, videoDuration: 9, caption: 'a', hashtags: [] },
  ])),
  NoReelsError: class extends Error {},
}))
vi.mock('../lib/reelVideoClient', () => ({ scrapeReelVideos: vi.fn(async () => new Map([['r1', 'https://v/r1.mp4']])) }))
vi.mock('../lib/singleReelCache', () => ({ getCachedSingleReel: vi.fn(async () => undefined), setCachedSingleReel: vi.fn() }))
vi.mock('../lib/reelHookmap', () => ({
  singleReelFnAvailable: vi.fn(async () => true),
  analyzeReelHookmap: vi.fn(async () => ({ transcript: 't1', segments: [], videoAnalysis: {}, markdown: '# r1' })),
}))
vi.mock('../lib/reelAnalyzer', async (orig) => ({
  ...(await orig()),
  synthesizeCreatorHooks: vi.fn(async () => ({
    handle: 'alice',
    reelCount: 1,
    dominantHooks: [],
    recurringOpenings: [],
    whatConsistentlyWorks: [],
    replicableTemplates: [],
    narrative: 'test narrative',
    benchmarks: { medianViews: 10, medianLikes: 1, commentsLikesRatio: 0.1 },
  })),
}))

import { useReelAnalysis } from './useReelAnalysis'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { scrapeTopReels } from '../lib/reelScraper'

beforeEach(() => useReelAnalysisStore.getState().reset())

describe('single-handle HookMap pipeline', () => {
  it('analyzes each reel via the HookMap analyzer and stores the case study', async () => {
    const { result } = renderHook(() => useReelAnalysis())
    await act(async () => { await result.current.startAnalysis(['alice']) })
    await waitFor(() => {
      const c = useReelAnalysisStore.getState().creatorStates['alice']
      expect(c?.caseStudyStatus?.r1).toBe('done')
      expect(c?.caseStudies?.r1?.markdown).toBe('# r1')
    })
  })

  it('synthesizes creator hook summary after HookMap analysis completes', async () => {
    const { result } = renderHook(() => useReelAnalysis())
    await act(async () => { await result.current.startAnalysis(['alice']) })
    await waitFor(() => {
      const c = useReelAnalysisStore.getState().creatorStates['alice']
      expect(c?.hookSummary).toBeDefined()
      expect(c?.hookSummary?.handle).toBe('alice')
      expect(c?.hookSummary?.reelCount).toBe(1)
      expect(c?.hookSummary?.narrative).toBe('test narrative')
    })
  })

  it('drives synthesisStatus to "done" (with synthesis null) so harvest/snapshot/persist gates fire', async () => {
    const { result } = renderHook(() => useReelAnalysis())
    await act(async () => { await result.current.startAnalysis(['alice']) })
    await waitFor(() => {
      const s = useReelAnalysisStore.getState()
      expect(s.synthesisStatus).toBe('done')
      // CreatorHookSummary drives the UI via hookSummary — the niche synthesis object stays null.
      expect(s.synthesis).toBeNull()
    })
  })

  it('runs the HookMap analyzer per creator for MULTIPLE handles (selected competitors)', async () => {
    const { result } = renderHook(() => useReelAnalysis())
    await act(async () => { await result.current.startAnalysis(['alice', 'bob']) })
    await waitFor(() => {
      const states = useReelAnalysisStore.getState().creatorStates
      // Both selected competitors get the deep case study (not the quick caption path).
      expect(states['alice']?.caseStudyStatus?.r1).toBe('done')
      expect(states['bob']?.caseStudyStatus?.r1).toBe('done')
      expect(states['alice']?.caseStudies?.r1?.markdown).toBe('# r1')
      expect(states['bob']?.caseStudies?.r1?.markdown).toBe('# r1')
      expect(useReelAnalysisStore.getState().synthesisStatus).toBe('done')
    })
  })

  // Regression: an interrupted run (the agent loop supersedes it, or navigating away aborts it)
  // must NOT leave the store stuck at synthesisStatus 'running' with activeHandles set. That stale
  // state survives SPA navigation (no reload, so the persist `merge` guard never re-runs to discard
  // it) and makes ChatPage's `isReelRunning` true forever — which disables competitor selection.
  it('clears the run when it is aborted mid-flight instead of leaving it stuck on "running"', async () => {
    // Hold the scrape open so the run parks at synthesisStatus 'running' until we abort it.
    let releaseScrape: (reels: unknown[]) => void = () => {}
    vi.mocked(scrapeTopReels).mockImplementationOnce(
      () => new Promise((resolve) => { releaseScrape = resolve as (r: unknown[]) => void }),
    )

    // Abort through the external-signal path (how the agent loop supersedes a reel run) — this
    // doesn't depend on mount/unmount bookkeeping, so it isolates the abort behavior cleanly.
    const external = new AbortController()
    const { result } = renderHook(() => useReelAnalysis())
    let started: Promise<void> | undefined
    await act(async () => { started = result.current.startAnalysis(['alice'], external.signal) })

    // The run is now parked on the hanging scrape.
    await waitFor(() => expect(useReelAnalysisStore.getState().synthesisStatus).toBe('running'))
    expect(useReelAnalysisStore.getState().activeHandles).toEqual(['alice'])

    // Supersede / interrupt the run.
    external.abort()
    await act(async () => {
      releaseScrape([])      // let the parked pipeline resume and hit its abort checks
      await started
    })

    // The stale run must be cleared — not frozen at 'running' with handles still set, which would
    // keep `isReelRunning` true and block competitor selection.
    expect(useReelAnalysisStore.getState().synthesisStatus).not.toBe('running')
    expect(useReelAnalysisStore.getState().activeHandles).toEqual([])
  })
})
