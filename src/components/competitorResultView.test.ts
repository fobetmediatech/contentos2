import { describe, it, expect } from 'vitest'
import { mergeCompetitorResults } from './competitorResultView'
import type { CompetitorAnalysisResult } from '../ai/prompts'

const mk = (username: string, category: 'top' | 'trending', rank: number): CompetitorAnalysisResult => ({
  username,
  category,
  rank,
  rationale: '',
})

describe('mergeCompetitorResults', () => {
  it('returns just the fresh set (reranked) when nothing is carried', () => {
    const fresh = [mk('t2', 'top', 2), mk('t1', 'top', 1), mk('g1', 'trending', 1)]
    const out = mergeCompetitorResults([], fresh)
    expect(out.map((c) => c.username)).toEqual(['t1', 't2', 'g1'])
    expect(out.map((c) => c.rank)).toEqual([1, 2, 1]) // renumbered per category
  })

  it('carries relevant + adds fresh, combined into one set', () => {
    // carried: 1 top + 4 trending (the user kept these). fresh: 4 top + 1 trending (the gap).
    const carried = [
      mk('t1', 'top', 1),
      ...[1, 2, 3, 4].map((r) => mk(`g${r}`, 'trending', r)),
    ]
    const fresh = [
      ...[1, 2, 3, 4].map((r) => mk(`nt${r}`, 'top', r)),
      mk('g5', 'trending', 5),
    ]
    const out = mergeCompetitorResults(carried, fresh)
    expect(out.filter((c) => c.category === 'top')).toHaveLength(5)
    expect(out.filter((c) => c.category === 'trending')).toHaveLength(5)
    expect(out).toHaveLength(10)
    // ranks renumbered uniquely within each category
    expect(out.filter((c) => c.category === 'top').map((c) => c.rank)).toEqual([1, 2, 3, 4, 5])
    expect(out.filter((c) => c.category === 'trending').map((c) => c.rank)).toEqual([1, 2, 3, 4, 5])
  })

  it('dedupes by username (fresh wins) and caps each category at 5', () => {
    const carried = [...Array(6)].map((_, i) => mk(`t${i}`, 'top', i + 1))
    const fresh = [mk('t0', 'top', 1)] // same username as a carried one
    const out = mergeCompetitorResults(carried, fresh)
    const tops = out.filter((c) => c.category === 'top')
    expect(tops).toHaveLength(5) // capped
    // t0 present once (deduped)
    expect(tops.filter((c) => c.username === 't0')).toHaveLength(1)
  })

  it('re-ranks the whole set by original rank across runs (interleaves)', () => {
    const carried = [mk('a', 'top', 1), mk('c', 'top', 3)]
    const fresh = [mk('b', 'top', 2)]
    const out = mergeCompetitorResults(carried, fresh)
    expect(out.map((c) => c.username)).toEqual(['a', 'b', 'c'])
    expect(out.map((c) => c.rank)).toEqual([1, 2, 3])
  })
})
