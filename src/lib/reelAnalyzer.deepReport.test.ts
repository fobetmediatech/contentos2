/**
 * Tests for buildDeepReportTable (Phase 2) — the code-computed half of the niche report.
 */

import { describe, it, expect } from 'vitest'
import { buildDeepReportTable } from './reelAnalyzer'
import type { DeepCreatorPlaybook } from '../ai/prompts/deepReelAnalysis'

const pb = (over: Partial<DeepCreatorPlaybook>): DeepCreatorPlaybook => ({
  handle: 'x',
  reelCount: 0,
  archetypeDistribution: [],
  dominantArchetype: '',
  avgHookScore: 0,
  medianViews: 0,
  consistencyScore: 0,
  signatureTemplate: '',
  topExemplar: null,
  ...over,
})

describe('buildDeepReportTable', () => {
  it('aggregates archetype distribution across creators, builds comparison, sorts exemplars', () => {
    const playbooks = [
      pb({
        handle: 'a',
        reelCount: 3,
        archetypeDistribution: [
          { archetype: 'Curiosity gap', count: 2 },
          { archetype: 'Visual shock', count: 1 },
        ],
        dominantArchetype: 'Curiosity gap',
        avgHookScore: 7.2,
        medianViews: 1000,
        topExemplar: { shortCode: 'a1', hookArchetype: 'Curiosity gap', hookScore: 9, spokenHookVerbatim: 'hi', visualOpening: 'v', views: 5000 },
      }),
      pb({
        handle: 'b',
        reelCount: 2,
        archetypeDistribution: [{ archetype: 'Curiosity gap', count: 2 }],
        dominantArchetype: 'Curiosity gap',
        avgHookScore: 6,
        medianViews: 800,
        topExemplar: { shortCode: 'b1', hookArchetype: 'Curiosity gap', hookScore: 9, spokenHookVerbatim: 'yo', visualOpening: 'v2', views: 9000 },
      }),
    ]
    const t = buildDeepReportTable(playbooks)

    expect(t.archetypeDistribution[0]).toEqual({ archetype: 'Curiosity gap', count: 4 })
    expect(t.archetypeDistribution.find((d) => d.archetype === 'Visual shock')?.count).toBe(1)
    expect(t.comparison).toHaveLength(2)
    expect(t.comparison[0].handle).toBe('a')
    // both exemplars score 9 -> higher views (b) wins the tiebreak
    expect(t.topExemplars[0].handle).toBe('b')
    expect(t.topExemplars).toHaveLength(2)
  })

  it('skips creators with no exemplar', () => {
    const t = buildDeepReportTable([pb({ handle: 'a', reelCount: 1, topExemplar: null })])
    expect(t.topExemplars).toHaveLength(0)
    expect(t.comparison).toHaveLength(1)
  })
})
