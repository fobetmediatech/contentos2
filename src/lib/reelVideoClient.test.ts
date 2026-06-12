/**
 * Tests for reelVideoClient: the pure extractReelVideos helper + scrapeReelVideos
 * orchestration (apifyCore mocked at the boundary; real ApifyError + limiter kept).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  startRun: vi.fn(),
  pollRun: vi.fn(),
  fetchDataset: vi.fn(),
  pickAvailableKey: vi.fn(),
}))

vi.mock('./apifyCore', async (orig) => {
  const actual = await orig<typeof import('./apifyCore')>()
  return {
    ...actual, // keep the real ApifyError + apifyRunLimiter (pLimit(1) pass-through)
    startRun: mocks.startRun,
    pollRun: mocks.pollRun,
    fetchDataset: mocks.fetchDataset,
  }
})
vi.mock('./keyRotator', () => ({
  pickAvailableKey: mocks.pickAvailableKey,
  markKeyCooldown: vi.fn(),
}))

import { extractReelVideos, scrapeReelVideos } from './reelVideoClient'
import { ApifyError } from './apifyCore'

describe('extractReelVideos', () => {
  it('maps shortCode -> downloadedVideo for good items', () => {
    const { videos, errors } = extractReelVideos([
      { shortCode: 'a', downloadedVideo: 'urlA' },
      { shortCode: 'b', downloadedVideo: 'urlB' },
    ])
    expect(videos.size).toBe(2)
    expect(videos.get('a')).toBe('urlA')
    expect(errors).toBe(0)
  })

  it('omits reels with no downloadedVideo (partial)', () => {
    const { videos, errors } = extractReelVideos([
      { shortCode: 'a', downloadedVideo: 'urlA' },
      { shortCode: 'b' }, // no video -> skipped by caller
      { shortCode: 'c', downloadedVideo: '' }, // empty -> skipped
    ])
    expect(videos.size).toBe(1)
    expect(videos.has('a')).toBe(true)
    expect(errors).toBe(0)
  })

  it('counts blocked error-records', () => {
    const { videos, errors } = extractReelVideos([
      { error: 'no_items', requestErrorMessages: ['blocked'] },
      { error: 'no_items' },
    ])
    expect(videos.size).toBe(0)
    expect(errors).toBe(2)
  })

  it('handles a mix of good + errored items', () => {
    const { videos, errors } = extractReelVideos([
      { shortCode: 'a', downloadedVideo: 'urlA' },
      { error: 'x' },
    ])
    expect(videos.size).toBe(1)
    expect(errors).toBe(1)
  })
})

describe('scrapeReelVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pickAvailableKey.mockReturnValue('key-1')
    mocks.startRun.mockResolvedValue({ runId: 'r', datasetId: 'd' })
    mocks.pollRun.mockResolvedValue('d')
  })

  it('returns an empty map (and runs no actor) for no URLs', async () => {
    const out = await scrapeReelVideos([], ['key-1'])
    expect(out.size).toBe(0)
    expect(mocks.startRun).not.toHaveBeenCalled()
  })

  it('throws RATE_LIMITED when the proxy reports all server keys exhausted (429)', async () => {
    // Phase 1: empty apifyKeys is normal (server holds them); RATE_LIMITED comes from
    // the proxy returning 429, which startRun translates to ApifyError('RATE_LIMITED').
    mocks.startRun.mockRejectedValueOnce(new ApifyError('RATE_LIMITED', 'All server keys exhausted', 429))
    await expect(scrapeReelVideos(['https://www.instagram.com/reel/a/'], [])).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('returns a shortCode -> URL map on success', async () => {
    mocks.fetchDataset.mockResolvedValue([
      { shortCode: 'a', downloadedVideo: 'urlA' },
      { shortCode: 'b', downloadedVideo: 'urlB' },
    ])
    const out = await scrapeReelVideos(['https://www.instagram.com/reel/a/', 'https://www.instagram.com/reel/b/'], ['key-1'])
    expect(out.size).toBe(2)
    expect(out.get('b')).toBe('urlB')
    expect(mocks.startRun).toHaveBeenCalledOnce() // ONE batch run, not per-reel
  })

  it('throws when the run is fully blocked (all error-records)', async () => {
    mocks.fetchDataset.mockResolvedValue([{ error: 'no_items', requestErrorMessages: ['blocked'] }])
    await expect(scrapeReelVideos(['https://www.instagram.com/reel/a/'], ['key-1'])).rejects.toBeInstanceOf(ApifyError)
  })

  it('returns a partial map without throwing when some reels lack video', async () => {
    mocks.fetchDataset.mockResolvedValue([{ shortCode: 'a', downloadedVideo: 'urlA' }, { shortCode: 'b' }])
    const out = await scrapeReelVideos(['https://www.instagram.com/reel/a/', 'https://www.instagram.com/reel/b/'], ['key-1'])
    expect(out.size).toBe(1)
    expect(out.has('a')).toBe(true)
  })
})
