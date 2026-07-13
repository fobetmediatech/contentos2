// @vitest-environment jsdom
/**
 * TDD test for Task 6: useSingleReelAnalysis refactored to be run-scoped.
 *
 * New signature: startSingleReel(runId: RunId, reelUrl: string, signal: AbortSignal)
 * Writes progress + result via runsStore (not singleReelStore).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRunsStore } from '../store/runsStore'
import { useSingleReelAnalysis } from './useSingleReelAnalysis'

// Mock parseReelUrl from the actual import used in the hook
vi.mock('../lib/reelUrl', () => ({
  parseReelUrl: (url: string) => {
    const m = /\/reel\/([A-Za-z0-9_-]+)/.exec(url)
    if (!m) return null
    return { shortCode: m[1], canonicalUrl: `https://www.instagram.com/reel/${m[1]}/` }
  },
}))

// Mock scrapeSingleReel from the actual import used in the hook
vi.mock('../lib/singleReelClient', () => ({
  scrapeSingleReel: vi.fn().mockResolvedValue({
    shortCode: 'abc',
    url: 'https://www.instagram.com/reel/abc/',
    downloadedVideoUrl: 'https://cdn.apify.com/video/abc.mp4',
    ownerUsername: 'testuser',
    caption: 'test caption',
    likesCount: 100,
    commentsCount: 10,
    videoViewCount: 1000,
    videoDuration: 30,
    hashtags: [],
    timestamp: '2024-01-01',
    musicInfo: null,
    displayUrl: 'https://cdn.apify.com/thumb/abc.jpg',
  }),
}))

// Mock single-reel cache to always MISS so the scrape path runs
vi.mock('../lib/singleReelCache', () => ({
  getCachedSingleReel: vi.fn().mockResolvedValue(null),
  setCachedSingleReel: vi.fn().mockResolvedValue(undefined),
}))

// Mock getClerkSessionToken so no real auth is needed
vi.mock('../lib/clerkToken', () => ({
  getClerkSessionToken: vi.fn().mockResolvedValue('test-token'),
}))

// Mock keysStore so apifyKeys is always an empty array (keys live server-side)
vi.mock('../store/keysStore', () => ({
  useKeysStore: Object.assign(
    vi.fn(() => ({ apifyKeys: [] })),
    { getState: () => ({ apifyKeys: [] }) },
  ),
}))

// Mock corpusStore so rememberContent doesn't throw
vi.mock('../store/corpusStore', () => ({
  useCorpusStore: Object.assign(
    vi.fn(() => ({ rememberContent: vi.fn().mockResolvedValue(undefined) })),
    { getState: () => ({ rememberContent: vi.fn().mockResolvedValue(undefined) }) },
  ),
}))

// Mock fetch globally to return a valid single-reel analysis response
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () =>
    Promise.resolve({
      result: {
        markdown: '# case',
        transcript: '',
        segments: [],
        videoAnalysis: {
          duration_s: null,
          aspect_ratio: '9:16',
          dominant_framing: 'medium',
          cuts_count: null,
          text_overlay_density: 'low',
          captions_present: null,
          trending_audio_hint: '',
          t0_frame: '',
          visual_beats: [],
          notable_moments: [],
        },
      },
    }),
  clone: () => ({ text: () => Promise.resolve('') }),
})
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  useRunsStore.setState({ runs: {}, seq: 0 })
  mockFetch.mockClear()
})

describe('useSingleReelAnalysis run-scoped', () => {
  it('finishes with a single-reel result payload', async () => {
    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'single-reel',
      targetLabel: 'r',
      progress: '',
    })
    const { result } = renderHook(() => useSingleReelAnalysis())
    await result.current.startSingleReel(runId, 'https://insta/reel/abc', new AbortController().signal)
    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('done')
    expect(run.result).toMatchObject({ kind: 'single-reel' })
  })

  it('finishes with a single-reel payload containing the canonical url and shortCode', async () => {
    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'single-reel',
      targetLabel: 'abc',
      progress: '',
    })
    const { result } = renderHook(() => useSingleReelAnalysis())
    await result.current.startSingleReel(runId, 'https://www.instagram.com/reel/abc/', new AbortController().signal)
    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('done')
    expect(run.result).toMatchObject({
      kind: 'single-reel',
      shortCode: 'abc',
      reelUrl: 'https://www.instagram.com/reel/abc/',
      result: { markdown: '# case' },
    })
  })

  it('calls failRun when fetch returns non-ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      clone: () => ({ text: () => Promise.resolve('server error') }),
    })

    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'single-reel',
      targetLabel: 'abc',
      progress: '',
    })

    const { result } = renderHook(() => useSingleReelAnalysis())
    await result.current.startSingleReel(runId, 'https://www.instagram.com/reel/abc/', new AbortController().signal)

    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('failed')
    expect(run.error).toBe('Could not analyse that reel.')
  })

  it('calls failRun when URL is not a reel link', async () => {
    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'single-reel',
      targetLabel: 'bad-url',
      progress: '',
    })

    const { result } = renderHook(() => useSingleReelAnalysis())
    await result.current.startSingleReel(runId, 'https://example.com/notareel', new AbortController().signal)

    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('failed')
  })

  it('returns without writing done/failed to store when signal is aborted', async () => {
    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'single-reel',
      targetLabel: 'abc',
      progress: '',
    })

    const controller = new AbortController()
    controller.abort()

    const { result } = renderHook(() => useSingleReelAnalysis())
    await result.current.startSingleReel(runId, 'https://www.instagram.com/reel/abc/', controller.signal)

    // Run should still be 'running' since abort → silent return
    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('running')
  })
})
