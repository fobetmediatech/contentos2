import { describe, it, expect, vi, afterEach } from 'vitest'
import { analyzeSingleReel, HandlerError } from './analyze-single-reel'
import * as files from './_lib/geminiFiles'
import * as text from './_lib/geminiText'

afterEach(() => vi.restoreAllMocks())

const VIDEO_URL = 'https://api.apify.com/v2/key-value-stores/x/records/ABC.mp4'

function mockVideoFetch() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'video/mp4' }),
    arrayBuffer: async () => new ArrayBuffer(1024),
  } as unknown as Response)
}

describe('analyzeSingleReel', () => {
  it('rejects a non-allowlisted host', async () => {
    await expect(
      analyzeSingleReel({ downloadedVideoUrl: 'https://evil.com/a.mp4', shortCode: 'ABC', apify: {} }, 'k'),
    ).rejects.toBeInstanceOf(HandlerError)
  })

  it('runs extraction → synthesis and returns the combined result', async () => {
    mockVideoFetch()
    vi.spyOn(files, 'analyzeVideoWithGemini').mockResolvedValue({
      data: {
        transcript: 'hello world', segments: [{ start: 0, text: 'hello world' }],
        videoAnalysis: { t0_frame: 'a face', visual_beats: [] },
      },
      usage: null,
    })
    vi.spyOn(text, 'geminiGenerateMarkdown').mockResolvedValue('# @garyvee\n\ngreat reel')

    const out = await analyzeSingleReel(
      { downloadedVideoUrl: VIDEO_URL, shortCode: 'ABC', apify: { ownerUsername: 'garyvee', caption: 'hi', likesCount: 100, commentsCount: 2 } },
      'k',
    )
    expect(out.transcript).toBe('hello world')
    expect(out.segments).toEqual([{ start: 0, text: 'hello world' }])
    expect(out.markdown).toContain('@garyvee')
  })
})
