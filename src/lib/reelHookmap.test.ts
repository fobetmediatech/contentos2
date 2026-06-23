import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReelData } from '../store/reelAnalysisStore'
import { analyzeReelHookmap } from './reelHookmap'

vi.mock('./clerkToken', () => ({ getClerkSessionToken: async () => 'tok' }))

const reel = (over: Partial<ReelData> = {}): ReelData => ({
  shortCode: 'abc',
  url: 'https://www.instagram.com/reel/abc/',
  displayUrl: '',
  videoViewCount: 1,
  likesCount: 1,
  commentsCount: 1,
  videoDuration: 10,
  caption: 'c',
  hashtags: [],
  ...over,
})

afterEach(() => vi.restoreAllMocks())

describe('analyzeReelHookmap', () => {
  it('POSTs the reel to /api/analyze-single-reel and returns result on 200', async () => {
    const result = { transcript: 't', segments: [], videoAnalysis: {}, markdown: '# m' }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ result }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await analyzeReelHookmap('alice', reel(), 'https://video/abc.mp4')
    expect(out).toEqual(result)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/analyze-single-reel')
    expect((opts as RequestInit).method).toBe('POST')
    expect(JSON.parse((opts as RequestInit).body as string).apify.ownerUsername).toBe('alice')
  })

  it('returns null when the server responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await analyzeReelHookmap('alice', reel(), 'https://video/abc.mp4')).toBeNull()
  })
})
