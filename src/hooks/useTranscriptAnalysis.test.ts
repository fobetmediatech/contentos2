// @vitest-environment jsdom
/**
 * TDD test for Task 5: useTranscriptAnalysis refactored to be run-scoped.
 *
 * New signature: startTranscript(runId: RunId, reelUrl: string, signal: AbortSignal)
 * Writes progress + result via runsStore (not transcriptStore).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRunsStore } from '../store/runsStore'
import { useTranscriptAnalysis } from './useTranscriptAnalysis'

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
    shortCode: 'abc123',
    url: 'https://www.instagram.com/reel/abc123/',
    downloadedVideoUrl: 'https://cdn.apify.com/video/abc123.mp4',
    ownerUsername: 'testuser',
    caption: null,
    likesCount: 0,
  }),
}))

// Mock transcript cache to always MISS so the scrape path runs
vi.mock('../lib/transcriptCache', () => ({
  getCachedTranscript: vi.fn().mockResolvedValue(null),
  setCachedTranscript: vi.fn().mockResolvedValue(undefined),
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

// Mock fetch globally to return a valid transcript response
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ result: { transcript: 'hi', segments: [] } }),
  clone: () => ({ text: () => Promise.resolve('') }),
})
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  useRunsStore.setState({ runs: {}, seq: 0 })
  mockFetch.mockClear()
})

describe('useTranscriptAnalysis run-scoped', () => {
  it('finishes the run with a transcript result payload', async () => {
    // Caller creates the run first (new contract)
    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'transcript',
      targetLabel: 'abc123',
      progress: '',
    })

    const { result } = renderHook(() => useTranscriptAnalysis())
    await result.current.startTranscript(
      runId,
      'https://www.instagram.com/reel/abc123/',
      new AbortController().signal,
    )

    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('done')
    expect(run.result).toMatchObject({ kind: 'transcript', transcript: 'hi' })
  })

  it('calls failRun when fetch returns non-ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      clone: () => ({ text: () => Promise.resolve('server error') }),
    })

    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'transcript',
      targetLabel: 'abc123',
      progress: '',
    })

    const { result } = renderHook(() => useTranscriptAnalysis())
    await result.current.startTranscript(
      runId,
      'https://www.instagram.com/reel/abc123/',
      new AbortController().signal,
    )

    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('failed')
    expect(run.error).toBe('Could not transcribe that reel.')
  })

  it('calls failRun when URL is not a reel link', async () => {
    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'transcript',
      targetLabel: 'bad-url',
      progress: '',
    })

    const { result } = renderHook(() => useTranscriptAnalysis())
    await result.current.startTranscript(runId, 'https://example.com/notareel', new AbortController().signal)

    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('failed')
  })

  it('returns without writing to store when signal is aborted', async () => {
    const runId = useRunsStore.getState().createRun({
      conversationId: 'c1',
      kind: 'transcript',
      targetLabel: 'abc123',
      progress: '',
    })

    const controller = new AbortController()
    controller.abort()

    const { result } = renderHook(() => useTranscriptAnalysis())
    await result.current.startTranscript(
      runId,
      'https://www.instagram.com/reel/abc123/',
      controller.signal,
    )

    // Run should still be 'running' since abort → silent return
    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('running')
  })
})
