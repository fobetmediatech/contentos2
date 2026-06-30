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

export const REEL_REWRITE_PROMPT_VERSION = 3

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
    `- Language / English-Hindi mix: ${v.language || '—'}`,
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

/** Verbatim exemplar lines from the client's real content — few-shot fuel so the model imitates
 *  actual cadence, not the abstract voice description. Empty profiles fall back to the profile. */
function exemplarsBlock(v: VoiceProfile): string {
  const ex = (v.exemplars ?? []).map((s) => s.trim()).filter(Boolean)
  if (!ex.length) return '(no verbatim samples available — lean on the voice profile above)'
  return ex.map((e) => `- "${e.replace(/"/g, '\\"')}"`).join('\n')
}

export function buildReelRewritePrompt(source: SingleReelResult, voice: VoiceProfile): string {
  const verbatimHook = source.segments?.[0]?.text ?? source.transcript.slice(0, 120)
  return `You are a short-form scriptwriter. Rewrite a viral reel so it sounds like @${voice.handle} ACTUALLY talking — keep the source reel's structure that made it work, but say it in their real voice. The output must sound like a human said it out loud in one take, NOT like AI wrote it.

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

### How @${voice.handle} ACTUALLY talks — match THIS cadence and energy (copy the rhythm, NEVER the topic):
${exemplarsBlock(voice)}

## WRITE FOR THE EAR — flow + no AI slop (this is what makes or breaks it)

- FLOW: write the whole script as ONE continuous spoken take. Each beat must run into the next like someone talking without stopping — natural verbal hand-offs, momentum carried forward. No line may read as a standalone bullet or a fresh start.
- SOUND SPOKEN, not written: short sentences and fragments, contractions, the rhythm of real speech, one idea per breath. Read each line back — if it sounds like an essay or a caption, rewrite it until it sounds SAID.
- USE THE SAMPLES above: borrow @${voice.handle}'s real words, fillers, and energy. If their samples are punchy and casual, be punchy and casual.
- BANNED — these are the AI tells that make a script feel like slop; do NOT use them:
  • em-dashes used as dramatic pauses
  • filler openers: "here's the thing", "let's dive in", "but here's the kicker", "the truth is", "in today's video", "we need to talk about"
  • listicle scaffolding: "number one… number two", "reason one"
  • over-explaining or restating the same point twice
  • hedge words: "kind of", "sort of", "arguably", "essentially"
  • essay/corporate transitions: "furthermore", "moreover", "that said", "in conclusion"
- Every single line must pass: "Could @${voice.handle} have said this out loud, in one take, without it sounding written?"

## Rules

- LANGUAGE — match the CLIENT, NOT the source reel: write in the SAME language and the SAME English↔Hindi mix that @${voice.handle} actually uses (judge from their Language field + the exemplar lines above). If their samples are mostly or fully English, write in English and only drop in Hindi words to the SAME small degree they do — do NOT turn an English-speaking creator into Hinglish. If their samples are genuinely heavy Hinglish, match that. When the client's mix is unclear, DEFAULT TO ENGLISH. The source reel's own language is IRRELEVANT — only the client's voice decides this.
- SCRIPT: Latin/Roman letters only. Romanize any Hindi as Hinglish ("yeh viral ho gaya"), and NEVER output Devanagari or any non-Latin script in any field.
- Preserve the source's beat structure EXACTLY: same number of beats, same beat functions, same CTA placement. Replace ONLY the words and energy — NEVER copy the source's wording.
- spokenHook: the rewritten opening line (verbatim, ready to say to camera).
- beatScript: one entry per source beat — beatLabel (its function), script (what they say, flowing on from the previous beat), onScreenText (the overlay).
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
