import { describe, it, expect } from 'vitest'
import { buildDeepReelPrompt, buildDeepReportPrompt, DEEP_REEL_PROMPT_VERSION } from '../deepReelAnalysis'

describe('buildDeepReelPrompt (strengthened)', () => {
  const p = buildDeepReelPrompt('comment GUIDE for the free checklist')

  it('keeps grounding in the actual media', () => {
    expect(p).toContain('SEE the video frames AND HEAR the audio')
  })
  it('forbids fabrication and fake timestamps', () => {
    expect(p).toMatch(/\[unknown/i)
    expect(p).toMatch(/never fabricate a timestamp/i)
  })
  it('requires [m:ss] timestamp citations', () => {
    expect(p).toMatch(/\[m:ss\]/)
    expect(p).toMatch(/\[0:03\]/)
  })
  it('demands because-grounding and specificity', () => {
    expect(p).toMatch(/because/i)
    expect(p).toMatch(/not "?emotional hook"?/i)
  })
  it('encourages compound (primary + secondary) hooks', () => {
    expect(p).toMatch(/compound/i)
    expect(p).toContain('secondaryArchetype')
  })
  it('flags engineered DM funnels qualitatively', () => {
    expect(p).toMatch(/funnel/i)
  })
  it('still lists every required field', () => {
    for (const f of ['spokenHookVerbatim', 'visualOpening', 'hookBreakdown', 'pacingEditing', 'audioStrategy', 'hookScore']) {
      expect(p).toContain(f)
    }
  })
})

describe('DEEP_REEL_PROMPT_VERSION', () => {
  it('is bumped to 2 so the deep cache lazily invalidates', () => {
    expect(DEEP_REEL_PROMPT_VERSION).toBe(2)
  })
})
