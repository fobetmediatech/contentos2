/**
 * Fan-out seam tests: verify that both analyze_single_reel and get_reel_transcript
 * accept either a single reelUrl OR a reelUrls array, and always produce a canonical
 * { reelUrls: string[] } shape after validation.
 */

import { describe, it, expect } from 'vitest'
import { validateToolCall } from './agentTools'

const REEL_1 = 'https://www.instagram.com/reel/ABC123/'
const REEL_2 = 'https://www.instagram.com/reel/XYZ789/'
// Variants Gemini might emit (trailing slash, query params, mobile domain)
const REEL_1_DIRTY = 'https://instagram.com/reel/ABC123?igsh=abc'
const REEL_2_DIRTY = 'https://www.instagram.com/reels/XYZ789'

// ── analyze_single_reel ──────────────────────────────────────────────────────

describe('analyze_single_reel fan-out', () => {
  it('single reelUrl → reelUrls array of length 1', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrl: REEL_1 })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.args.reelUrls).toEqual([REEL_1])
  })

  it('reelUrls array of 2 → reelUrls array of 2 canonical URLs', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrls: [REEL_1_DIRTY, REEL_2_DIRTY] })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect((v.args.reelUrls as string[])).toHaveLength(2)
    expect((v.args.reelUrls as string[])[0]).toBe(REEL_1)
    expect((v.args.reelUrls as string[])[1]).toBe(REEL_2)
  })

  it('reelUrls wins over reelUrl when both are present', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrl: REEL_1, reelUrls: [REEL_2] })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.args.reelUrls).toEqual([REEL_2])
  })

  it('rejects when neither reelUrl nor reelUrls is provided', () => {
    const v = validateToolCall('analyze_single_reel', {})
    expect(v.ok).toBe(false)
  })

  it('rejects when reelUrls is an empty array', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrls: [] })
    expect(v.ok).toBe(false)
  })

  it('rejects when all URLs are invalid (no valid reel links)', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrls: ['https://instagram.com/garyvee'] })
    expect(v.ok).toBe(false)
  })

  it('filters out invalid URLs when mixed with valid ones', () => {
    const v = validateToolCall('analyze_single_reel', {
      reelUrls: ['https://instagram.com/garyvee', REEL_1],
    })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.args.reelUrls).toEqual([REEL_1])
  })
})

// ── get_reel_transcript ──────────────────────────────────────────────────────

describe('get_reel_transcript fan-out', () => {
  it('single reelUrl → reelUrls array of length 1', () => {
    const v = validateToolCall('get_reel_transcript', { reelUrl: REEL_1 })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.args.reelUrls).toEqual([REEL_1])
  })

  it('reelUrls array of 2 → reelUrls array of 2 canonical URLs', () => {
    const v = validateToolCall('get_reel_transcript', { reelUrls: [REEL_1_DIRTY, REEL_2_DIRTY] })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect((v.args.reelUrls as string[])).toHaveLength(2)
    expect((v.args.reelUrls as string[])[0]).toBe(REEL_1)
    expect((v.args.reelUrls as string[])[1]).toBe(REEL_2)
  })

  it('reelUrls wins over reelUrl when both are present', () => {
    const v = validateToolCall('get_reel_transcript', { reelUrl: REEL_1, reelUrls: [REEL_2] })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.args.reelUrls).toEqual([REEL_2])
  })

  it('rejects when neither reelUrl nor reelUrls is provided', () => {
    const v = validateToolCall('get_reel_transcript', {})
    expect(v.ok).toBe(false)
  })

  it('rejects when reelUrls is an empty array', () => {
    const v = validateToolCall('get_reel_transcript', { reelUrls: [] })
    expect(v.ok).toBe(false)
  })

  it('rejects when all URLs are invalid', () => {
    const v = validateToolCall('get_reel_transcript', { reelUrls: ['https://instagram.com/garyvee'] })
    expect(v.ok).toBe(false)
  })

  it('filters out invalid URLs when mixed with valid ones', () => {
    const v = validateToolCall('get_reel_transcript', {
      reelUrls: ['https://instagram.com/garyvee', REEL_2],
    })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.args.reelUrls).toEqual([REEL_2])
  })
})
