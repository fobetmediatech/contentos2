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
  brandColors: string           // optional — hex/names, used to tint the doc
  dislikes: string              // topics/styles the client dislikes
  offLimits: string             // off-limits topics (legal / sensitivity)
}

export const EMPTY_BRIEF: StrategyBrief = {
  brandName: '', primaryNiche: '', subNiche: '', offer: '', language: 'hinglish',
  audience: '', competitors: ['', '', '', '', ''], aspirational: ['', '', '', ''],
  brandColors: '', dislikes: '', offLimits: '',
}

/** The synthesized strategy (Gemini output, schema-validated). */
export interface ContentStrategyDoc {
  positioning: string
  audienceInsight: string
  competitiveSummary: string
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
}

/** Everything the printable document needs: the brief, the analysis, and the synthesized strategy. */
export interface StrategyResult {
  brief: StrategyBrief
  doc: ContentStrategyDoc
  accounts: AnalyzedAccount[]          // analyzed competitors + discovered + aspirational
  hookSummaries: CreatorHookSummary[]  // HookMap synthesis per analyzed creator
  generatedAt: number
}
