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
vi.mock('../lib/reelAnalyzer', async (orig) => ({ ...(await orig()), synthesizeCreatorHooks: vi.fn(async () => null) }))

import { useReelAnalysis } from './useReelAnalysis'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'

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
})
