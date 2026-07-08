/**
 * Domain types for the Content Strategizing feature.
 *
 * StrategyBrief = the onboarding form (mirrors Fobet's Client Onboarding Input Sheet) — the
 * business context ContentOS can't scrape (brand, offer, language, audience, constraints) plus
 * the seed handles. ContentStrategyDoc = the synthesized strategy (Gemini output). StrategyResult
 * bundles the brief + the backend analysis (competitor metrics + HookMap summaries) + the doc, so
 * the printable document can show user inputs and machine analysis side by side.
 */
import type { CreatorHookSummary } from '../ai/prompts/creatorHookSummary'

export type ContentLanguage = 'english' | 'hindi' | 'hinglish'

/** Per-client deck look. preset picks the base palette; accent (hex, optional) overrides from brand colors. */
export type DeckPreset = 'black-gold' | 'cream-yellow' | 'chai' | 'light'
export interface DeckTheme {
  preset: DeckPreset
  accent: string // hex override; '' = preset/brand-color accent
  bg: string     // hex override for the slide background; '' = preset background
}
export const DEFAULT_THEME: DeckTheme = { preset: 'black-gold', accent: '', bg: '' }

/** The onboarding form — user-provided business context + seed handles. */
export interface StrategyBrief {
  brandName: string
  primaryNiche: string
  subNiche: string
  offer: string                 // "What exactly are we selling" — the CTA destination
  language: ContentLanguage
  audience: string
  competitors: string[]         // up to 5 direct-competitor @handles (analysis seeds)
  aspirational: string[]        // up to 4 aspirational @handles (style to replicate)
  brandColors: string           // optional — hex/names; also used as the deck accent
  dislikes: string              // topics/styles the client dislikes
  offLimits: string             // off-limits topics (legal / sensitivity)
  theme: DeckTheme              // per-client deck look (presentation only)
}

export const EMPTY_BRIEF: StrategyBrief = {
  brandName: '', primaryNiche: '', subNiche: '', offer: '', language: 'hinglish',
  audience: '', competitors: ['', '', '', '', ''], aspirational: ['', '', '', ''],
  brandColors: '', dislikes: '', offLimits: '', theme: { ...DEFAULT_THEME },
}

/** The synthesized strategy (Gemini output, schema-validated). */
export interface ContentStrategyDoc {
  positioning: string
  audienceInsight: string
  competitiveSummary: string
  /** Romanized (Latin-Hinglish) bullets synthesizing the winning hooks — never Devanagari. */
  whatsWorking: string[]
  contentPillars: Array<{ name: string; description: string }>
  hookFormulas: Array<{ name: string; template: string; example: string }>
  contentIdeas: Array<{ title: string; hook: string; format: string; pillar: string }>
  formatMix: Array<{ format: string; weight: string; rationale: string }>
  cadence: { postsPerWeek: string; notes: string }
  voiceAndTone: string
  dos: string[]
  donts: string[]
}

/** A competitor/aspirational account after backend analysis (metrics only — for the landscape table). */
export interface AnalyzedAccount {
  username: string
  fullName: string
  followers: number
  engagementRate: number | null
  verified: boolean
  source: 'competitor' | 'discovered' | 'aspirational'
  profilePicUrl: string  // IG CDN url — shown via /api/image-proxy with an initials fallback
}

/** Everything the printable document needs: the brief, the analysis, and the synthesized strategy. */
export interface StrategyResult {
  brief: StrategyBrief
  doc: ContentStrategyDoc
  accounts: AnalyzedAccount[]          // analyzed competitors + discovered + aspirational
  hookSummaries: CreatorHookSummary[]  // HookMap synthesis per analyzed creator
  generatedAt: number
}

/**
 * A strategy saved to the shared team list (Supabase `client_strategies`). Wraps the full
 * StrategyResult so it re-opens/re-prints with no re-analysis; brandName/offer are denormalized
 * from the brief for the list view. createdBy = Clerk user id (audit only).
 */
export interface SavedClientStrategy {
  id: string
  brandName: string
  offer: string
  result: StrategyResult
  createdBy: string | null
  createdAt: number
  updatedAt: number
}

/**
 * A reference file attached to a saved client (Supabase `client_strategy_attachments` + the
 * `client-strategy-files` storage bucket). Informational only — never drives any pipeline.
 */
export interface StrategyAttachment {
  id: string
  strategyId: string
  fileName: string
  storagePath: string        // path inside the client-strategy-files bucket
  mimeType: string | null
  sizeBytes: number | null
  uploadedBy: string | null
  createdAt: number
}
