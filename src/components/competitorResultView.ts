/**
 * Pure view-model derivation for a competitor result payload — kept out of the component
 * file so Fast Refresh stays happy (component files should only export components) and so the
 * splitting/sorting/cohort-ER logic is unit-testable in isolation.
 */

import type { CompetitorResultPayload } from '../store/analysisStore'
import type { NormalizedProfile } from '../lib/transformers'
import type { CompetitorAnalysisResult } from '../ai/prompts'
import { deriveRankedView } from './rankedResultView'

export function deriveCompetitorView(payload: CompetitorResultPayload): {
  profileMap: Map<string, NormalizedProfile>
  cohortAvgER: number
  top: CompetitorAnalysisResult[]
  trending: CompetitorAnalysisResult[]
} {
  return deriveRankedView(payload.competitors, payload.profiles)
}

/**
 * Merge carried-over relevant competitors (from prior runs) with this run's fresh ones into one
 * accumulated set, so "Start over" can render the full collection together. Dedupes by username
 * (fresh wins), then re-ranks the WHOLE set per category by original rank and renumbers 1..N,
 * capping each category at `perCategoryMax` (5 → 5 established + 5 growing). Pure — unit-tested.
 */
export function mergeCompetitorResults(
  carried: CompetitorAnalysisResult[],
  fresh: CompetitorAnalysisResult[],
  perCategoryMax = 5,
): CompetitorAnalysisResult[] {
  const byUser = new Map<string, CompetitorAnalysisResult>()
  for (const c of carried) byUser.set(c.username.toLowerCase(), c)
  for (const c of fresh) byUser.set(c.username.toLowerCase(), c) // fresh wins on a dup
  const all = [...byUser.values()]
  const rerank = (cat: 'top' | 'trending') =>
    all
      .filter((c) => c.category === cat)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, perCategoryMax)
      .map((c, i) => ({ ...c, rank: i + 1 }))
  return [...rerank('top'), ...rerank('trending')]
}
