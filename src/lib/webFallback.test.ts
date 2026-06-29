/**
 * Tests for the scrape-blocked web fallback: when Instagram blocks Apify, this path ranks
 * competitors DIRECTLY from web search (no scrape). The pure units (parse + stub mapper) carry
 * the safety contract: real handles only, NO fabricated metrics (ER stays null), coarse size band
 * only. The orchestrator must NEVER throw — a failed grounded call degrades to an empty result so
 * the hook can fall through to today's error message as a last resort.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// webFallbackCompetitors runs ONE web-grounded call; mock it so the test stays pure + offline.
vi.mock('../ai/gemini', () => ({ callGeminiGroundedJson: vi.fn() }))

import {
  parseWebFallbackResult,
  sizeBandToFollowers,
  webFallbackToProfiles,
  webFallbackCompetitors,
} from './webFallback'
import { callGeminiGroundedJson } from '../ai/gemini'

const wellFormed = {
  niche: 'personal finance',
  summary: 'Indian personal-finance IG is led by a few big educators; many rising tax/stock creators.',
  competitors: [
    { handle: '@CA.Rachana', name: 'CA Rachana', category: 'top', rank: 1, rationale: 'Leading finance educator', size_band: 'ESTABLISHED' },
    { handle: 'sharan', name: 'Sharan Hegde', category: 'trending', rank: 1, rationale: 'Fast-rising finance creator', size_band: 'RISING' },
  ],
}

describe('parseWebFallbackResult', () => {
  it('parses a well-formed object into split, sanitized competitors', () => {
    const out = parseWebFallbackResult(wellFormed)
    expect(out.niche).toBe('personal finance')
    expect(out.summary).toContain('Indian personal-finance')
    expect(out.competitors).toHaveLength(2)
    const top = out.competitors.find((c) => c.category === 'top')!
    expect(top.handle).toBe('ca.rachana') // @ stripped, lowercased
    expect(top.sizeBand).toBe('ESTABLISHED')
    expect(out.competitors.some((c) => c.category === 'trending')).toBe(true)
  })

  it('defaults niche/summary to empty and competitors to [] for junk input', () => {
    expect(parseWebFallbackResult(null).competitors).toEqual([])
    expect(parseWebFallbackResult('nope').niche).toBe('')
    expect(parseWebFallbackResult({}).summary).toBe('')
  })

  it('drops entries with no handle and dedups by handle (case-insensitive)', () => {
    const out = parseWebFallbackResult({ competitors: [
      { handle: '', name: 'No handle', category: 'top' },
      { handle: 'dup', category: 'top' },
      { handle: 'DUP', category: 'trending' },
    ] })
    expect(out.competitors).toHaveLength(1)
    expect(out.competitors[0].handle).toBe('dup')
  })

  it('normalizes an invalid size_band to MID and caps 5 per tier', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ handle: `top${i}`, category: 'top', size_band: 'HUGE' }))
    const out = parseWebFallbackResult({ competitors: many })
    expect(out.competitors.filter((c) => c.category === 'top')).toHaveLength(5)
    expect(out.competitors[0].sizeBand).toBe('MID')
  })
})

describe('sizeBandToFollowers + webFallbackToProfiles', () => {
  it('maps ESTABLISHED above the 500K Top-tier line and RISING into the Trending range', () => {
    expect(sizeBandToFollowers('ESTABLISHED')).toBeGreaterThan(500_000)
    expect(sizeBandToFollowers('RISING')).toBeLessThan(100_000)
  })

  it('builds stub profiles with NO fabricated engagement (ER null) and band-derived followers', () => {
    const profiles = webFallbackToProfiles([
      { handle: 'ca.rachana', name: 'CA Rachana', category: 'top', rank: 1, rationale: 'Leading educator', sizeBand: 'ESTABLISHED' },
    ])
    expect(profiles).toHaveLength(1)
    expect(profiles[0].username).toBe('ca.rachana')
    expect(profiles[0].fullName).toBe('CA Rachana')
    expect(profiles[0].engagementRate).toBeNull()
    expect(profiles[0].followersCount).toBeGreaterThan(500_000)
  })
})

describe('webFallbackCompetitors orchestrator', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ranked competitors (AnalysisOutput shape) + stub profiles from a grounded reply', async () => {
    vi.mocked(callGeminiGroundedJson).mockResolvedValue(wellFormed)
    const { output, profiles } = await webFallbackCompetitors(['k'], { handles: ['themoneylancer'], niche: 'personal finance' })
    expect(output.competitors).toHaveLength(2)
    expect(output.niche).toBe('personal finance')
    expect(output.competitors[0]).toHaveProperty('username') // handle → username for the ranking schema
    expect(profiles).toHaveLength(2)
  })

  it('never throws — degrades to an empty result when the grounded call fails', async () => {
    vi.mocked(callGeminiGroundedJson).mockRejectedValue(new Error('grounding down'))
    const { output, profiles } = await webFallbackCompetitors(['k'], { handles: ['x'], niche: 'fitness' })
    expect(output.competitors).toEqual([])
    expect(profiles).toEqual([])
  })

  it('degrades to empty when the grounded reply names zero usable competitors', async () => {
    vi.mocked(callGeminiGroundedJson).mockResolvedValue({ niche: 'x', summary: 'y', competitors: [] })
    const { output, profiles } = await webFallbackCompetitors(['k'], { handles: ['x'], niche: 'fitness' })
    expect(output.competitors).toEqual([])
    expect(profiles).toEqual([])
  })
})
