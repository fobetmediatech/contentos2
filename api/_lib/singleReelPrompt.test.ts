import { describe, it, expect } from 'vitest'
import {
  SINGLE_REEL_EXTRACTION_SCHEMA,
  buildExtractionPrompt,
  buildSynthesisPrompt,
  coerceExtraction,
} from './singleReelPrompt'

describe('extraction prompt + schema', () => {
  it('asks for a verbatim transcript with timestamped segments', () => {
    const p = buildExtractionPrompt()
    expect(p).toMatch(/transcribe/i)
    expect(p).toMatch(/segments/)
    expect(p).toMatch(/visual_beats/)
    expect(p).toMatch(/never invent/i)
  })
  it('schema requires transcript, segments, videoAnalysis', () => {
    expect(SINGLE_REEL_EXTRACTION_SCHEMA.required).toEqual(
      expect.arrayContaining(['transcript', 'segments', 'videoAnalysis']),
    )
  })
})

describe('coerceExtraction', () => {
  it('fills defaults and coerces segment shapes', () => {
    const out = coerceExtraction({
      transcript: 'hello world',
      segments: [{ start: 0.4, text: 'hello' }, { start: 'bad', text: 'world' }],
      videoAnalysis: { cuts_count: 3, t0_frame: 'a face' },
    })
    expect(out.transcript).toBe('hello world')
    expect(out.segments[0]).toEqual({ start: 0.4, text: 'hello' })
    expect(out.segments[1].start).toBe(0) // non-finite → 0
  })
  it('survives a totally malformed payload', () => {
    const out = coerceExtraction(null)
    expect(out.transcript).toBe('')
    expect(out.segments).toEqual([])
    expect(out.videoAnalysis).toBeTypeOf('object')
  })
  it('preserves explicit null sentinels for unknown numeric fields', () => {
    const out = coerceExtraction({
      transcript: '', segments: [],
      videoAnalysis: { duration_s: null, cuts_count: null, t0_frame: 'x', visual_beats: [{ t_start: null, t_end: null, on_screen: 'a', function: 'b' }] },
    })
    expect(out.videoAnalysis.duration_s).toBeNull()
    expect(out.videoAnalysis.cuts_count).toBeNull()
    expect(out.videoAnalysis.visual_beats[0].t_start).toBeNull()
  })
})

describe('synthesis prompt', () => {
  it('mandates [m:ss] citations, anti-fabrication, and the markdown sections', () => {
    const p = buildSynthesisPrompt()
    expect(p).toMatch(/\[m:ss\]/)
    expect(p).toMatch(/never fabricate a timestamp/i)
    expect(p).toMatch(/## Hook/)
    expect(p).toMatch(/## Psychology/)
    expect(p).toMatch(/## Topic/)
    expect(p).toMatch(/Pure markdown/i)
  })
  it('does NOT request comments or creator-benchmark sections in v1', () => {
    const p = buildSynthesisPrompt()
    expect(p).not.toMatch(/creator_benchmark/)
    expect(p).not.toMatch(/What viewers actually said/)
  })
})
