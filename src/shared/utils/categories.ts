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
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
  },
  trending: {
    id: 'trending',
    label: 'Trending',
    sectionLabel: 'Trending 5 — Growing Accounts',
    taxonomy:
      'Accounts in their growth phase — ER significantly exceeds what is typical for their follower tier, signalling active momentum. Typically under 500K followers; accounts with 500K+ followers are established players (Top category) regardless of ER. Rising creators (under 100K) and fast-growing mid-tier accounts (100K–500K) with high relative engagement are the target.',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
  },
}

export type CategoryId = keyof typeof COMPETITOR_CATEGORIES
