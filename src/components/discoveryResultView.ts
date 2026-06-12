/**
 * Pure view-model derivation for a discovery result payload — parallels competitorResultView.
 * Kept out of the component file (Fast Refresh) and unit-testable in isolation.
 */

import type { DiscoveryResultPayload } from '../store/analysisStore'
import type { NormalizedProfile } from '../lib/transformers'
import type { DiscoveryResult } from '../ai/prompts'
import { deriveRankedView } from './rankedResultView'

export function deriveDiscoveryView(payload: DiscoveryResultPayload): {
  profileMap: Map<string, NormalizedProfile>
  cohortAvgER: number
  top: DiscoveryResult[]
  trending: DiscoveryResult[]
} {
  return deriveRankedView(payload.results, payload.profiles)
}
