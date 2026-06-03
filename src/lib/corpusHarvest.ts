/**
 * Corpus harvesters — turn a finished pipeline result into the CreatorInput[] the corpus
 * remembers. Each ranked entry is joined to its profile (by username) and paired with a
 * sighting capturing where/why it was surfaced. Entries without a matching profile are
 * dropped — they have no metrics to remember and aren't shown to the user anyway.
 */

import type { NormalizedProfile } from './transformers'
import type { CompetitorAnalysisResult, DiscoveryResult } from '../ai/prompts'
import type { CreatorAnalysisState } from '../store/reelAnalysisStore'
import type { CreatorInput, ContentRecord } from './corpus'

export function harvestCompetitors(
  competitors: CompetitorAnalysisResult[],
  profiles: NormalizedProfile[],
  niche: string,
  at: number,
): CreatorInput[] {
  const byName = new Map(profiles.map((p) => [p.username, p]))
  return competitors.flatMap((c) => {
    const profile = byName.get(c.username)
    if (!profile) return []
    return [{
      profile,
      sighting: {
        at,
        pipeline: 'competitor' as const,
        niche,
        category: c.category,
        rank: c.rank,
        rationale: c.rationale,
      },
    }]
  })
}

export function harvestDiscovery(
  results: DiscoveryResult[],
  profiles: NormalizedProfile[],
  city: string,
  niche: string,
  at: number,
): CreatorInput[] {
  const byName = new Map(profiles.map((p) => [p.username, p]))
  return results.flatMap((r) => {
    const profile = byName.get(r.username)
    if (!profile) return []
    return [{
      profile,
      sighting: {
        at,
        pipeline: 'discovery' as const,
        niche,
        city,
        category: r.category,
        rank: r.rank,
        rationale: r.rationale,
        specialties: r.specialties,
        contentFocus: r.contentFocus,
        partnershipReady: r.partnershipReady,
        locationConfidence: r.locationConfidence,
      },
    }]
  })
}

/**
 * Turn a finished reel run into ContentRecord[] for the corpus — one record per reel of each
 * creator whose analysis completed. The quick hook analysis (archetype + opening line) rides
 * along when present. This is the "content" half of the creator/content corpus.
 */
export function harvestReelContent(
  creatorStates: Record<string, CreatorAnalysisState>,
  at: number,
): ContentRecord[] {
  const out: ContentRecord[] = []
  for (const [handle, state] of Object.entries(creatorStates)) {
    if (state.status !== 'done') continue // only creators whose analysis finished
    for (const reel of state.reels) {
      const analysis = state.analyses[reel.shortCode]
      out.push({
        id: reel.shortCode,
        creatorUsername: handle,
        kind: 'reel',
        url: reel.url,
        caption: reel.caption,
        videoViewCount: reel.videoViewCount,
        likesCount: reel.likesCount,
        commentsCount: reel.commentsCount,
        hookArchetype: analysis?.hookArchetype,
        openingLine: analysis?.openingLine,
        analyzedAt: at,
      })
    }
  }
  return out
}
