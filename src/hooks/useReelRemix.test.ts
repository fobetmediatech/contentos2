import { describe, it, expect } from 'vitest'
import { buildLibrarySource } from './useReelRemix'
import type { SingleReelResult } from '../store/singleReelStore'

const REEL = { shortCode: 'ABC', transcript: 'hello world' }

describe('buildLibrarySource', () => {
  it('uses cached beats when the deep analysis is cached', () => {
    const cached = { videoAnalysis: { visual_beats: [{ t_start: 0, t_end: 1, on_screen: 'x', function: 'hook' }] } } as unknown as SingleReelResult
    const out = buildLibrarySource(REEL, cached)
    expect(out.platform).toBe('instagram')
    expect(out.transcript).toBe('hello world')
    expect(out.source.beats).toHaveLength(1)
  })
  it('is transcript-only (no beats) on cache miss', () => {
    const out = buildLibrarySource(REEL, undefined)
    expect(out.source.transcript).toBe('hello world')
    expect(out.source.beats).toBeUndefined()
  })
})
