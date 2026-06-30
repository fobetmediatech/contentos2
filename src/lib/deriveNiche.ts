/**
 * Derive a short niche query from already-scraped reference profiles.
 *
 * Used as the web-search FALLBACK for a bare `@handle` competitor search: when the user gives
 * only a handle (no explicit niche) and that account's relatedProfiles graph is closed, the pool
 * comes back empty and the run dead-ends with "no related public accounts". Deriving a niche from
 * the reference account's own signals lets the web-grounded seed sources (generateNicheSeeds) run
 * and build a pool from creators the graph walk can't reach.
 *
 * Signal priority (strongest niche signal first):
 *   1. top hashtags across the reference profiles — the most direct content-niche signal
 *   2. Instagram's own business/creator category
 *   3. the first few biography words
 *   4. the display name (last resort)
 *
 * Pure + dependency-free so the rule is unit-tested without a scrape.
 */

import type { NormalizedProfile } from './transformers'

/** Keep derived niches short — they feed both a web-search query and an IG keyword search. */
const NICHE_MAX = 80

export function deriveNicheFromProfiles(profiles: NormalizedProfile[]): string {
  if (profiles.length === 0) return ''

  // 1. Hashtags across ALL reference profiles (deduped, first-seen order, capped). When several
  //    handles are given with no niche, their shared tags are the strongest combined signal.
  const seen = new Set<string>()
  const tags: string[] = []
  for (const p of profiles) {
    for (const tag of p.topHashtags) {
      const t = tag.replace(/^#/, '').trim()
      if (!t || seen.has(t.toLowerCase())) continue
      seen.add(t.toLowerCase())
      tags.push(t)
      if (tags.length >= 4) break
    }
    if (tags.length >= 4) break
  }
  if (tags.length > 0) return tags.join(' ').slice(0, NICHE_MAX)

  const primary = profiles[0]

  // 2. IG's own category (e.g. "Personal finance", "Fitness trainer").
  const category = (primary.businessCategoryName ?? '').trim()
  if (category) return category.slice(0, NICHE_MAX)

  // 3. First few bio words (newlines stripped to avoid prompt-injection via bio text).
  const bioWords = primary.biography.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
  if (bioWords) return bioWords.slice(0, NICHE_MAX)

  // 4. Display name — last resort so an account with only a name still seeds the web search.
  return (primary.fullName ?? '').trim().slice(0, NICHE_MAX)
}
