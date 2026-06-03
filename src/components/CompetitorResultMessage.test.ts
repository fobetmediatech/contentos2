/**
 * Tests for deriveCompetitorView — the pure view-model behind CompetitorResultMessage.
 * Splitting/sorting and the cohort-ER default are the only non-trivial logic; the render is
 * a straight port of the (previously shipped) status-driven block.
 */

import { describe, it, expect } from 'vitest'
import { deriveCompetitorView } from './competitorResultView'
import type { CompetitorResultPayload } from '../store/analysisStore'
import type { CompetitorAnalysisResult } from '../ai/prompts'
import type { NormalizedProfile } from '../lib/transformers'

const comp = (username: string, category: 'top' | 'trending', rank: number): CompetitorAnalysisResult => ({
  username,
  category,
  rank,
  rationale: '',
})
const prof = (username: string, engagementRate: number): NormalizedProfile =>
  ({ username, engagementRate } as unknown as NormalizedProfile)

const payload = (competitors: CompetitorAnalysisResult[], profiles: NormalizedProfile[]): CompetitorResultPayload => ({
  kind: 'competitor',
  competitors,
  summary: '',
  niche: '',
  didExpand: false,
  profiles,
})

describe('deriveCompetitorView', () => {
  it('splits top vs trending and sorts each by rank', () => {
    const v = deriveCompetitorView(
      payload([comp('b', 'top', 2), comp('a', 'top', 1), comp('c', 'trending', 1)], []),
    )
    expect(v.top.map((c) => c.username)).toEqual(['a', 'b'])
    expect(v.trending.map((c) => c.username)).toEqual(['c'])
  })

  it('cohortAvgER averages the ranked competitors’ profile ERs', () => {
    const v = deriveCompetitorView(
      payload([comp('a', 'top', 1), comp('b', 'top', 2)], [prof('a', 4), prof('b', 6)]),
    )
    expect(v.cohortAvgER).toBe(5)
  })

  it('cohortAvgER defaults to 3.0 when no profile ERs are available', () => {
    const v = deriveCompetitorView(payload([comp('a', 'top', 1)], []))
    expect(v.cohortAvgER).toBe(3.0)
  })

  it('builds a profileMap keyed by username', () => {
    const v = deriveCompetitorView(payload([comp('a', 'top', 1)], [prof('a', 4.2)]))
    expect(v.profileMap.get('a')?.engagementRate).toBe(4.2)
  })
})
