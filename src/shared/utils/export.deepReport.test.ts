/**
 * Tests for formatDeepReportMarkdown (Phase 2) — the client-ready report export.
 */

import { describe, it, expect } from 'vitest'
import { formatDeepReportMarkdown } from './export'
import type { DeepNicheReport } from '../../ai/prompts/deepReelAnalysis'

const report: DeepNicheReport = {
  whoIsWinning: 'nike wins with bold claims',
  nicheFormula: 'open with a bold claim',
  gaps: ['g1'],
  replicate: ['r1'],
  avoid: ['a1'],
  test: ['t1'],
  archetypeDistribution: [{ archetype: 'Bold claim', count: 5 }],
  comparison: [{ handle: 'nike', reelCount: 8, avgHookScore: 7.5, medianViews: 12000, dominantArchetype: 'Bold claim' }],
  topExemplars: [{ handle: 'nike', shortCode: 'x', hookArchetype: 'Bold claim', hookScore: 9, spokenHookVerbatim: 'stop', visualOpening: 'a fast zoom', views: 50000 }],
}

describe('formatDeepReportMarkdown', () => {
  it('produces a client-ready markdown document', () => {
    const md = formatDeepReportMarkdown(report, ['nike'])
    expect(md).toContain('# Reel Intelligence — Niche Report')
    expect(md).toContain('Creators analyzed: @nike')
    expect(md).toContain("## Who's winning")
    expect(md).toContain('nike wins with bold claims')
    expect(md).toContain('## Winning formula')
    expect(md).toContain('- Bold claim ×5')
    expect(md).toContain('| @nike | 8 | 7.5 | 12K | Bold claim |')
    expect(md).toContain('"stop"')
    expect(md).toContain('## Replicate')
    expect(md).toContain('- r1')
  })

  it('omits empty sections', () => {
    const empty: DeepNicheReport = {
      whoIsWinning: '',
      nicheFormula: '',
      gaps: [],
      replicate: [],
      avoid: [],
      test: [],
      archetypeDistribution: [],
      comparison: [],
      topExemplars: [],
    }
    const md = formatDeepReportMarkdown(empty, [])
    expect(md).toContain('# Reel Intelligence — Niche Report')
    expect(md).not.toContain('## Replicate')
    expect(md).not.toContain('## Creator comparison')
  })
})
