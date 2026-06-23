import { describe, it, expect } from 'vitest'
import { capByCategory } from './useCompetitorAnalysis'
import type { CompetitorAnalysisResult } from '../ai/prompts'

const mk = (username: string, category: 'top' | 'trending', rank: number): CompetitorAnalysisResult => ({
  username,
  category,
  rank,
  rationale: '',
})

// 5 top + 5 trending, ranks 1..5 each
const full: CompetitorAnalysisResult[] = [
  ...[1, 2, 3, 4, 5].map((r) => mk(`top${r}`, 'top', r)),
  ...[1, 2, 3, 4, 5].map((r) => mk(`tr${r}`, 'trending', r)),
]

describe('capByCategory', () => {
  it('returns [] when both targets are 0', () => {
    expect(capByCategory(full, 0, 0)).toEqual([])
  })

  it("fills each category's deficit independently (4 top, 1 trending)", () => {
    const out = capByCategory(full, 4, 1)
    expect(out.filter((c) => c.category === 'top')).toHaveLength(4)
    expect(out.filter((c) => c.category === 'trending')).toHaveLength(1)
    expect(out.map((c) => c.username)).toEqual(['top1', 'top2', 'top3', 'top4', 'tr1'])
  })

  it('shows only the growing folder when top is full (0 top, 1 trending)', () => {
    const out = capByCategory(full, 0, 1)
    expect(out).toEqual([mk('tr1', 'trending', 1)])
  })

  it('picks lowest ranks first within each category', () => {
    const shuffled: CompetitorAnalysisResult[] = [
      mk('top3', 'top', 3), mk('top1', 'top', 1), mk('top2', 'top', 2),
      mk('tr2', 'trending', 2), mk('tr1', 'trending', 1),
    ]
    const out = capByCategory(shuffled, 2, 1)
    expect(out.map((c) => c.username)).toEqual(['top1', 'top2', 'tr1'])
  })

  it('caps to available when a category has fewer than its target', () => {
    const sparse: CompetitorAnalysisResult[] = [mk('top1', 'top', 1), mk('tr1', 'trending', 1), mk('tr2', 'trending', 2)]
    const out = capByCategory(sparse, 5, 5) // wants 5+5, only 1 top + 2 trending exist
    expect(out.filter((c) => c.category === 'top')).toHaveLength(1)
    expect(out.filter((c) => c.category === 'trending')).toHaveLength(2)
  })

  it('treats negative targets as 0', () => {
    const out = capByCategory(full, -2, 2)
    expect(out.filter((c) => c.category === 'top')).toHaveLength(0)
    expect(out.filter((c) => c.category === 'trending')).toHaveLength(2)
  })
})
