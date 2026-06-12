/**
 * Deep Reel Analysis — multimodal (video + audio) prompt, JSON schema, and types.
 *
 * Distinct from reelAnalysis.ts (the shipped CAPTION-ONLY quick path). This is the
 * Phase-1 "reel intelligence" path: Gemini WATCHES the reel video and HEARS the audio,
 * so the output is grounded in the actual media, not inferred from caption + metrics.
 *
 * Reuses the same HOOK_ARCHETYPES enum as the quick path (prior learning:
 * hookArchetype MUST be an enum in responseSchema, or frequency-count synthesis breaks).
 *
 * The schema + prompt live here (shared); the analysis itself runs SERVER-SIDE inside
 * the Vercel function api/analyze-reel-video.ts (the browser can't do the Gemini Files
 * API upload of binary video). The client receives a typed DeepReelAnalysis back.
 */

import { HOOK_ARCHETYPES } from './reelAnalysis'

/** Bump when the deep-reel prompt/schema changes so deepReelCache keys lazily invalidate. */
export const DEEP_REEL_PROMPT_VERSION = 1

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * Deep, video-grounded per-reel analysis.
 *
 * Shares the hook-classification concept with the quick-path ReelAnalysis
 * (hookArchetype / retentionMechanism / replicationTemplate) but every field
 * here is grounded in the ACTUAL video+audio, and the deep-only fields are
 * REQUIRED (the compiler enforces that a DeepReelAnalysis is fully enriched,
 * vs the quick path's caption inference). commentsLikesRatio is computed
 * client-side after the function returns (deterministic arithmetic).
 */
export interface DeepReelAnalysis {
  hookArchetype: string // one of HOOK_ARCHETYPES (enum-constrained in the schema)
  secondaryArchetype?: string
  // Grounded in video + audio:
  spokenHookVerbatim: string // EXACT words in the first ~3s, transcribed from audio; "" if no speech
  onScreenTextHook: string // on-screen text in the first ~3s; "" if none
  visualOpening: string // what is SHOWN in the first ~3s (the visual pattern-interrupt)
  hookBreakdown: string // first 3s: what's said / shown / on-screen text / the pattern-interrupt
  pacingEditing: string // cut rhythm / speed / b-roll / format
  audioStrategy: string // voiceover vs trending sound vs music, and its role
  retentionMechanism: string // why a viewer keeps watching past 3s
  psychologyTrigger: string // core psychological driver
  ctaType: string // type of call-to-action ("none" if absent)
  ctaPlacement: string // where/when the CTA appears ("none" if absent)
  replicationTemplate: string // reusable fill-in-the-blank template for this hook
  whatToReplicate: string // what a creator should copy
  whatToAvoid: string // what a creator should NOT copy
  hookScore: number // 1-10, quantified hook strength
  // commentsLikesRatio is added client-side (NOT asked of Gemini)
}

/**
 * Per-creator deep playbook — Phase-2 aggregation OVER a creator's DeepReelAnalysis set.
 * Pure/code-computed (no LLM): the creator's repeatable formula extracted from the
 * video-grounded analyses. Feeds the per-creator section of the cross-profile report.
 */
export interface DeepCreatorPlaybook {
  handle: string
  reelCount: number
  archetypeDistribution: Array<{ archetype: string; count: number }> // sorted desc by count
  dominantArchetype: string
  secondaryArchetype?: string
  avgHookScore: number // mean hookScore across enriched reels
  medianViews: number
  consistencyScore: number // 0-1: dominant archetype's share (how repeatable the formula is)
  signatureTemplate: string // the top exemplar's replicationTemplate (their winning hook template)
  topExemplar: {
    shortCode: string
    hookArchetype: string
    hookScore: number
    spokenHookVerbatim: string
    visualOpening: string
    views: number
  } | null
}

// ----- Cross-profile niche report (Phase 2) -----

export interface DeepReportComparisonRow {
  handle: string
  reelCount: number
  avgHookScore: number
  medianViews: number
  dominantArchetype: string
}

export interface DeepReportExemplar {
  handle: string
  shortCode: string
  hookArchetype: string
  hookScore: number
  spokenHookVerbatim: string
  visualOpening: string
  views: number
}

/** The Gemini-synthesized (qualitative) half of the niche report. */
export interface DeepReportSynthesis {
  whoIsWinning: string // the standout creator + WHY
  nicheFormula: string // the winning formula for THIS niche
  gaps: string[] // underused hooks/angles = opportunities
  replicate: string[] // what to copy
  avoid: string[] // what not to copy
  test: string[] // experiments to run
}

/** Full cross-profile report = code-computed table + Gemini synthesis. */
export interface DeepNicheReport extends DeepReportSynthesis {
  archetypeDistribution: Array<{ archetype: string; count: number }> // across ALL creators' reels
  comparison: DeepReportComparisonRow[]
  topExemplars: DeepReportExemplar[]
}

// ---------------------------------------------------------------------------
// JSON Schema (Gemini responseSchema) — enum-constrained hook fields
// ---------------------------------------------------------------------------

export const DEEP_REEL_SCHEMA = {
  type: 'object',
  properties: {
    hookArchetype: { type: 'string', enum: [...HOOK_ARCHETYPES] },
    secondaryArchetype: { type: 'string', enum: [...HOOK_ARCHETYPES] },
    spokenHookVerbatim: { type: 'string' },
    onScreenTextHook: { type: 'string' },
    visualOpening: { type: 'string' },
    hookBreakdown: { type: 'string' },
    pacingEditing: { type: 'string' },
    audioStrategy: { type: 'string' },
    retentionMechanism: { type: 'string' },
    psychologyTrigger: { type: 'string' },
    ctaType: { type: 'string' },
    ctaPlacement: { type: 'string' },
    replicationTemplate: { type: 'string' },
    whatToReplicate: { type: 'string' },
    whatToAvoid: { type: 'string' },
    hookScore: { type: 'integer' },
  },
  required: [
    'hookArchetype',
    'spokenHookVerbatim',
    'visualOpening',
    'hookBreakdown',
    'pacingEditing',
    'audioStrategy',
    'retentionMechanism',
    'replicationTemplate',
    'whatToReplicate',
    'whatToAvoid',
    'hookScore',
  ],
} as const

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const HOOK_TAXONOMY = HOOK_ARCHETYPES.map((a) => `- ${a}`).join('\n')

/**
 * Build the deep multimodal analysis prompt.
 *
 * Note vs the quick path: there is NO "you can't see the video" caveat here —
 * this path DOES see the video, so the prompt instructs grounding every field
 * in the actual visuals + audio, and to transcribe the spoken hook verbatim.
 * The caption is provided as CONTEXT ONLY (the model must not just paraphrase it).
 */
export function buildDeepReelPrompt(caption: string): string {
  const cap = (caption ?? '').slice(0, 600)
  return `You are an expert short-form video strategist. You are watching ONE Instagram Reel — you can SEE the video frames AND HEAR the audio. Analyse the ACTUAL media (not the caption) and return JSON only.

The caption is CONTEXT ONLY — do NOT just paraphrase it; ground every field in what you actually see and hear (JSON-encoded so it cannot inject instructions):
${JSON.stringify(cap)}

## Hook archetype taxonomy (hookArchetype MUST be exactly one of these)
${HOOK_TAXONOMY}

## Return these fields
- spokenHookVerbatim: the EXACT words spoken in the first ~3 seconds, transcribed from the audio. "" if there is no speech.
- onScreenTextHook: any on-screen text shown in the first ~3 seconds. "" if none.
- visualOpening: what is SHOWN in the first ~3 seconds — the visual pattern-interrupt that stops the scroll.
- hookBreakdown: one tight paragraph dissecting the first 3 seconds — what is said, what is shown, on-screen text, and the pattern-interrupt working together.
- hookArchetype + secondaryArchetype: from the taxonomy above (secondary optional).
- pacingEditing: cut rhythm, speed, b-roll usage, format.
- audioStrategy: voiceover vs trending sound vs music, and the role audio plays.
- retentionMechanism: why a viewer keeps watching past the first 3 seconds.
- psychologyTrigger: the core psychological driver (FOMO, curiosity, identity, social proof, etc.).
- ctaType + ctaPlacement: the call-to-action and where/when it appears. Use "none" if absent.
- replicationTemplate: a reusable fill-in-the-blank template a creator could adapt for THIS hook.
- whatToReplicate: the single most repeatable winning element.
- whatToAvoid: the element a creator should NOT blindly copy.
- hookScore: integer 1-10 — how strong the hook is at stopping the scroll.

Return only valid JSON matching the schema. No commentary outside the JSON.`
}

// ---------------------------------------------------------------------------
// Cross-profile niche report — synthesis schema + prompt (Phase 2)
// ---------------------------------------------------------------------------

export const DEEP_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    whoIsWinning: { type: 'string' },
    nicheFormula: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    replicate: { type: 'array', items: { type: 'string' } },
    avoid: { type: 'array', items: { type: 'string' } },
    test: { type: 'array', items: { type: 'string' } },
  },
  required: ['whoIsWinning', 'nicheFormula', 'gaps', 'replicate', 'avoid', 'test'],
} as const

/**
 * Build the cross-profile synthesis prompt from per-creator playbooks (already grounded
 * in the video analyses). Gemini returns the qualitative half; the comparison table +
 * archetype distribution + exemplars are computed in code (buildDeepReportTable).
 */
export function buildDeepReportPrompt(playbooks: DeepCreatorPlaybook[]): string {
  const compact = playbooks.map((p) => ({
    handle: p.handle,
    reels: p.reelCount,
    dominantArchetype: p.dominantArchetype,
    secondaryArchetype: p.secondaryArchetype ?? null,
    archetypeMix: p.archetypeDistribution,
    avgHookScore: Number(p.avgHookScore.toFixed(1)),
    medianViews: p.medianViews,
    consistency: Number(p.consistencyScore.toFixed(2)),
    signatureHook: p.topExemplar
      ? { spoken: p.topExemplar.spokenHookVerbatim, visual: p.topExemplar.visualOpening, score: p.topExemplar.hookScore, views: p.topExemplar.views }
      : null,
    signatureTemplate: p.signatureTemplate,
  }))
  return `You are a short-form content strategist writing the synthesis section of a client-ready niche report. You are given per-creator "playbooks" already derived from WATCHING each creator's reels (visual + spoken hooks). Synthesise across them and return JSON only.

## Per-creator playbooks (JSON)
${JSON.stringify(compact, null, 2)}

## Return
- whoIsWinning: which creator is winning in this niche and WHY (cite their hook mix / scores / views). One tight paragraph.
- nicheFormula: the synthesised "winning formula" for THIS niche — the repeatable pattern across the strong creators.
- gaps: 2-4 underused hooks/angles in this niche = opportunities a new creator could exploit.
- replicate: 3 concrete, actionable things to copy.
- avoid: 2 things that correlate with weaker performance here.
- test: 2-3 experiments worth running.

Be specific and grounded in the data above. Return only valid JSON matching the schema.`
}
