/**
 * COMPETITOR_CATEGORIES — single source of truth for category labels and taxonomy.
 *
 * This config is injected into prompts.js at runtime (UC3).
 * Changing a label here changes: UI badges, AI prompt taxonomy, AI output, CSV export.
 * Nothing is hardcoded downstream.
 */

export interface CategoryDef {
  /** Internal key used in API responses and store */
  id: string
  /** Short label shown in UI badges */
  label: string
  /** Longer label for section headers */
  sectionLabel: string
  /** Description injected into AI prompt to guide classification */
  taxonomy: string
  /** Tailwind classes for the badge */
  badgeBg: string
  badgeText: string
}

export const COMPETITOR_CATEGORIES: Record<string, CategoryDef> = {
  top: {
    id: 'top',
    label: 'Top',
    sectionLabel: 'Top 5 — Established Authority',
    taxonomy:
      'Established authority accounts with large follower bases (typically 100K+), high absolute engagement numbers, consistent posting history, and strong brand recognition in the niche. These are the dominant players.',
    badgeBg: 'bg-[rgba(var(--accent-rgb),0.10)]',
    badgeText: 'text-[var(--color-accent-light)]',
  },
  trending: {
    id: 'trending',
    label: 'Trending',
    sectionLabel: 'Trending 5 — Rising Niche Accounts',
    taxonomy:
      'Rising creators with real traction in the SAME niche as the reference accounts — roughly 10K–500K followers. Niche membership is REQUIRED first — engagement rate is only the tiebreaker WITHIN the niche, never a substitute for it. Among niche-relevant accounts, prioritise those whose ER outpaces what is typical for their follower tier, signalling active momentum. EXCLUDE nano/micro accounts under ~10K followers: their ER is inflated by a tiny follower count and they are not meaningful competitors. 500K+ accounts are established players (Top) regardless of ER. NEVER include an off-niche or nano account here just because its engagement is high.',
    badgeBg: 'bg-[rgba(var(--accent-rgb),0.12)]',
    badgeText: 'text-[var(--color-accent)]',
  },
}

export type CategoryId = keyof typeof COMPETITOR_CATEGORIES

// ----- Discovery categories -----

/**
 * DISCOVERY_CATEGORIES — taxonomy for location-based creator discovery.
 *
 * Mirrors COMPETITOR_CATEGORIES structure but with discovery-context rationale.
 * These labels are injected into buildDiscoveryPrompt() and DiscoveryCard.tsx.
 */
export const DISCOVERY_CATEGORIES: Record<string, CategoryDef> = {
  top: {
    id: 'top',
    label: 'Top',
    sectionLabel: 'Established Authority',
    taxonomy:
      'Established authority in this city+niche: large follower base (typically 100K+), consistent posting, and strong community trust. These are the dominant voices in the local scene.',
    badgeBg: 'bg-[rgba(var(--accent-rgb),0.10)]',
    badgeText: 'text-[var(--color-accent-light)]',
  },
  trending: {
    id: 'trending',
    label: 'Trending',
    sectionLabel: 'Growing Voices',
    taxonomy:
      'Growth-phase creators: ER significantly exceeds their follower-tier average, signalling active momentum in the local scene. Typically under 500K followers. Accounts with 500K+ must go to Top.',
    badgeBg: 'bg-[rgba(var(--accent-rgb),0.12)]',
    badgeText: 'text-[var(--color-accent)]',
  },
}

export type DiscoveryCategoryId = keyof typeof DISCOVERY_CATEGORIES
