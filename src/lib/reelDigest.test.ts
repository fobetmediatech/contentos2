import { describe, it, expect } from 'vitest'
import { buildReelDigest, estimateTokens, digestText, planDigestChunks } from './reelDigest'

const result = (over = {}) => ({
  transcript: 'x'.repeat(5000), segments: [{ start: 0, text: 'first line here' }],
  videoAnalysis: { dominant_framing: 'talking head', cuts_count: 8, trending_audio_hint: 'none' } as never,
  markdown: '#'.repeat(9000), ...over,
})
const reel = (over = {}) => ({ shortCode: 'r1', url: 'u', displayUrl: '', videoViewCount: 1000, likesCount: 100, commentsCount: 10, videoDuration: 9, caption: 'c', hashtags: [], ...over })

describe('buildReelDigest', () => {
  it('drops the full markdown, bounds the transcript, and keeps hook + metrics', () => {
    const d = buildReelDigest(result() as never, reel() as never)
    expect(d.shortCode).toBe('r1'); expect(d.views).toBe(1000)
    expect(d.hookOpening).toContain('first line here')
    expect(d.hookOpening.length).toBeLessThanOrEqual(600 + 1)
    expect(digestText(d)).not.toContain('#'.repeat(9000)) // markdown excluded
  })
})

describe('planDigestChunks', () => {
  it('returns a single chunk when everything fits the budget', () => {
    const ds = [1,2,3].map((i) => buildReelDigest(result() as never, reel({ shortCode: 'r'+i }) as never))
    expect(planDigestChunks(ds, 1_000_000)).toHaveLength(1)
  })
  it('splits into multiple chunks when over budget, each under budget, preserving all reels', () => {
    const ds = Array.from({ length: 6 }, (_, i) => buildReelDigest(result() as never, reel({ shortCode: 'r'+i }) as never))
    const chunks = planDigestChunks(ds, estimateTokens(digestText(ds[0])) * 2 + 1) // ~2 per chunk
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat().map((d) => d.shortCode).sort()).toEqual(ds.map((d) => d.shortCode).sort())
    for (const c of chunks) expect(estimateTokens(c.map(digestText).join('\n'))).toBeLessThanOrEqual(estimateTokens(digestText(ds[0])) * 2 + 1)
  })
})
