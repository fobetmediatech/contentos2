/**
 * Server-side deep-reel prompt + schema + types (Phase 1) — used ONLY by the Vercel
 * function. The function is ESM and self-contained: it must NOT import runtime VALUES
 * from ../src (the app builds src with a different module resolution, and Node ESM can't
 * resolve those cross-boundary specifiers at runtime → ERR_MODULE_NOT_FOUND).
 *
 * HOOK_ARCHETYPES is duplicated from src/ai/prompts/reelAnalysis.ts on purpose (the
 * client/server boundary). KEEP THE 9 VALUES IN SYNC — the eval golden-set asserts the
 * server output's hookArchetype is one of these.
 */

export const HOOK_ARCHETYPES = [
  'Curiosity gap',
  'Contrarian claim',
  'Sunk-cost / identity threat',
  'Visual shock',
  'Direct callout',
  'Demo-first',
  'Story cold-open',
  'Question bait',
  'Authority / bandwagon FOMO',
] as const

/** Deep, video-grounded per-reel analysis (mirrors src/ai/prompts/deepReelAnalysis.ts). */
export interface DeepReelAnalysis {
  hookArchetype: string
  secondaryArchetype?: string
  spokenHookVerbatim: string
  onScreenTextHook: string
  visualOpening: string
  hookBreakdown: string
  pacingEditing: string
  audioStrategy: string
  retentionMechanism: string
  psychologyTrigger: string
  ctaType: string
  ctaPlacement: string
  replicationTemplate: string
  whatToReplicate: string
  whatToAvoid: string
  hookScore: number
}

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

const HOOK_TAXONOMY = HOOK_ARCHETYPES.map((a) => `- ${a}`).join('\n')

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
