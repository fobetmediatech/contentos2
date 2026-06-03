/**
 * Pure view-model derivation for a competitor result payload — kept out of the component
 * file so Fast Refresh stays happy (component files should only export components) and so the
 * splitting/sorting/cohort-ER logic is unit-testable in isolation.
 */

import type { ResultPayload } from '../store/analysisStore'
import type { NormalizedProfile } from '../lib/transformers'
import type { CompetitorAnalysisResult } from '../ai/prompts'

export function deriveCompetitorView(payload: ResultPayload): {
  profileMap: Map<string, NormalizedProfile>
  cohortAvgER: number
  top: CompetitorAnalysisResult[]
  trending: CompetitorAnalysisResult[]
} {
  const profileMap = new Map(payload.profiles.map((p) => [p.username, p]))
  const ers = payload.competitors
    .map((c) => profileMap.get(c.username)?.engagementRate)
    .filter((er): er is number => er !== null && er !== undefined)
  const cohortAvgER = ers.length > 0 ? ers.reduce((a, b) => a + b, 0) / ers.length : 3.0
  const top = payload.competitors.filter((c) => c.category === 'top').sort((a, b) => a.rank - b.rank)
  const trending = payload.competitors.filter((c) => c.category === 'trending').sort((a, b) => a.rank - b.rank)
  return { profileMap, cohortAvgER, top, trending }
}
