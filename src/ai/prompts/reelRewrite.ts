// src/ai/prompts/reelRewrite.ts
/**
 * Reel Rewrite — prompt + schema + type for repurposing a source reel into a client's voice.
 *
 * Takes the source reel's structure (SingleReelResult: transcript, segments, visual_beats,
 * markdown case study) plus a VoiceProfile, and produces a full shoot-ready package in the
 * client's voice. Pure text-in/text-out — runs through callGeminiWithSchema / /api/gemini.
 */

import type { SingleReelResult } from '../../store/singleReelStore'
import type { VoiceProfile } from './voiceProfile'

export const REEL_REWRITE_PROMPT_VERSION = 1

export interface ReelRewriteResult {
  spokenHook: string
  beatScript: Array<{ beatLabel: string; script: string; onScreenText: string }>
  caption: string
  cta: string
  onScreenText: string[]
  altHooks: string[]
}

export const REEL_REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    spokenHook: { type: 'string' },
    beatScript: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          beatLabel: { type: 'string' },
          script: { type: 'string' },
          onScreenText: { type: 'string' },
        },
        required: ['beatLabel', 'script', 'onScreenText'],
      },
    },
    caption: { type: 'string' },
    cta: { type: 'string' },
    onScreenText: { type: 'array', items: { type: 'string' } },
    altHooks: { type: 'array', items: { type: 'string' } },
  },
  required: ['spokenHook', 'beatScript', 'caption', 'cta', 'onScreenText', 'altHooks'],
}

function voiceBlock(v: VoiceProfile): string {
  return [
    `- Vocabulary / signature phrases: ${v.vocabulary.join(', ') || '—'}`,
    `- Formality: ${v.formality || '—'}`,
    `- Sentence rhythm: ${v.sentenceRhythm || '—'}`,
    `- Audience address: ${v.audienceAddress || '—'}`,
    `- Tone: ${v.toneDescriptors.join(', ') || '—'}`,
    `- Hook habits: ${v.hookHabits.join(' | ') || '—'}`,
    `- Emotional register: ${v.emotionalRegister || '—'}`,
    `- Structural pattern: ${v.structuralPattern || '—'}`,
  ].join('\n')
}

function beatsBlock(source: SingleReelResult): string {
  const beats = source.videoAnalysis?.visual_beats ?? []
  if (!beats.length) return '(no beat breakdown available — preserve the transcript order)'
  return beats
    .map((b, i) => `Beat ${i + 1} [${b.function || 'beat'}] (${b.t_start ?? '?'}–${b.t_end ?? '?'}s): on-screen "${b.on_screen || ''}"`)
    .join('\n')
}

export function buildReelRewritePrompt(source: SingleReelResult, voice: VoiceProfile): string {
  const verbatimHook = source.segments?.[0]?.text ?? source.transcript.slice(0, 120)
  return `You are a short-form scriptwriter. Repurpose a viral reel so it sounds like the creator @${voice.handle}, while KEEPING the source reel's structure that made it work.

## SOURCE reel structure (preserve this skeleton)

Verbatim spoken hook: "${verbatimHook}"

Beat breakdown:
${beatsBlock(source)}

Full transcript:
${source.transcript}

Hook / pacing / CTA analysis:
${source.markdown}

## TARGET voice — @${voice.handle}

${voiceBlock(voice)}

## Rules

- Preserve the source's beat structure EXACTLY: same number of beats, same beat functions, same CTA placement.
- Replace ONLY the words and energy so they match @${voice.handle}'s voice. NEVER copy the source's wording.
- Every line must pass the test: "Could @${voice.handle} have said this?"
- spokenHook: the rewritten opening line (verbatim, ready to say to camera).
- beatScript: one entry per source beat — beatLabel (its function), script (what they say), onScreenText (the overlay).
- caption: an Instagram caption in their voice.
- cta: a single call-to-action in their voice.
- onScreenText: 2-5 punchy overlay lines for the whole reel.
- altHooks: exactly 3 ALTERNATIVE opening hooks in their voice, for A/B testing.

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

/** Coerce raw LLM output; guarantees exactly 3 altHooks. Never throws. */
export function parseReelRewrite(raw: unknown): ReelRewriteResult {
  const r = (raw ?? {}) as Record<string, unknown>
  const beatScript = Array.isArray(r.beatScript)
    ? (r.beatScript as unknown[])
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b) => ({
          beatLabel: str(b.beatLabel, 'Beat'),
          script: str(b.script),
          onScreenText: str(b.onScreenText),
        }))
    : []
  const hooks = strArr(r.altHooks).slice(0, 3)
  while (hooks.length < 3) hooks.push('')
  return {
    spokenHook: str(r.spokenHook),
    beatScript,
    caption: str(r.caption),
    cta: str(r.cta),
    onScreenText: strArr(r.onScreenText),
    altHooks: hooks,
  }
}
