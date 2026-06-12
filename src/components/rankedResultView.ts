/**
 * Generic view-model derivation for ranked pipeline results (competitor + discovery).
 * Both pipelines produce a list of ranked items split into top/trending categories —
 * this single function handles both; the pipeline-specific wrappers name the types.
 */

import type { NormalizedProfile } from '../lib/transformers'

export function deriveRankedView<
  TResult extends { username: string; rank: number; category: string },
>(
  results: TResult[],
  profiles: NormalizedProfile[],
): {
  profileMap: Map<string, NormalizedProfile>
  cohortAvgER: number
  top: TResult[]
  trending: TResult[]
} {
  const profileMap = new Map(profiles.map((p) => [p.username, p]))
  const ers = results
    .map((r) => profileMap.get(r.username)?.engagementRate)
    .filter((er): er is number => er !== null && er !== undefined)
  const cohortAvgER = ers.length > 0 ? ers.reduce((a, b) => a + b, 0) / ers.length : 3.0
  const top = results.filter((r) => r.category === 'top').sort((a, b) => a.rank - b.rank)
  const trending = results.filter((r) => r.category === 'trending').sort((a, b) => a.rank - b.rank)
  return { profileMap, cohortAvgER, top, trending }
}
