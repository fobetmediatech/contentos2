/**
 * Pure view-model derivation for a discovery result payload — parallels competitorResultView.
 * Kept out of the component file (Fast Refresh) and unit-testable in isolation.
 */

import type { DiscoveryResultPayload } from '../store/analysisStore'
import type { NormalizedProfile } from '../lib/transformers'
import type { DiscoveryResult } from '../ai/prompts'

export function deriveDiscoveryView(payload: DiscoveryResultPayload): {
  profileMap: Map<string, NormalizedProfile>
  cohortAvgER: number
  top: DiscoveryResult[]
  trending: DiscoveryResult[]
} {
  const profileMap = new Map(payload.profiles.map((p) => [p.username, p]))
  const ers = payload.results
    .map((r) => profileMap.get(r.username)?.engagementRate)
    .filter((er): er is number => er !== null && er !== undefined)
  const cohortAvgER = ers.length > 0 ? ers.reduce((a, b) => a + b, 0) / ers.length : 3.0
  const top = payload.results.filter((r) => r.category === 'top').sort((a, b) => a.rank - b.rank)
  const trending = payload.results.filter((r) => r.category === 'trending').sort((a, b) => a.rank - b.rank)
  return { profileMap, cohortAvgER, top, trending }
}
