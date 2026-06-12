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
