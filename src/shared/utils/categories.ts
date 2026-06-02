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
    badgeBg: 'bg-[rgba(59,130,246,0.12)]',
    badgeText: 'text-[#60A5FA]',
  },
  trending: {
    id: 'trending',
    label: 'Trending',
    sectionLabel: 'Trending 5 — Growing Accounts',
    taxonomy:
      'Accounts in their growth phase — ER significantly exceeds what is typical for their follower tier, signalling active momentum. Typically under 500K followers; accounts with 500K+ followers are established players (Top category) regardless of ER. Rising creators (under 100K) and fast-growing mid-tier accounts (100K–500K) with high relative engagement are the target.',
    badgeBg: 'bg-[rgba(224,123,58,0.12)]',
    badgeText: 'text-[#E07B3A]',
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
    badgeBg: 'bg-[rgba(59,130,246,0.12)]',
    badgeText: 'text-[#60A5FA]',
  },
  trending: {
    id: 'trending',
    label: 'Trending',
    sectionLabel: 'Growing Voices',
    taxonomy:
      'Growth-phase creators: ER significantly exceeds their follower-tier average, signalling active momentum in the local scene. Typically under 500K followers. Accounts with 500K+ must go to Top.',
    badgeBg: 'bg-[rgba(224,123,58,0.12)]',
    badgeText: 'text-[#E07B3A]',
  },
}

export type DiscoveryCategoryId = keyof typeof DISCOVERY_CATEGORIES
