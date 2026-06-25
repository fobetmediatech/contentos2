// src/ai/prompts/voiceProfile.ts
/**
 * Voice Profile — prompt + schema + type for synthesizing a client's reel voice.
 *
 * Mirrors creatorHookSummary.ts: the LLM produces the qualitative half; handle/displayName/
 * reelCount/builtAt/fromScripts are attached in code (parseVoiceProfile). Consumed by
 * useRepurposeReel (build) and the rewrite prompt (reelRewrite.ts).
 */

export const VOICE_PROFILE_PROMPT_VERSION = 1

export interface VoiceProfile {
  handle: string
  displayName: string
  fromScripts: boolean
  vocabulary: string[]
  formality: string
  sentenceRhythm: string
  audienceAddress: string
  toneDescriptors: string[]
  hookHabits: string[]
  emotionalRegister: string
  structuralPattern: string
  personaConsistencyScore: number
  reelCount: number
  builtAt: number
}

/** The qualitative half the LLM returns; the rest is attached in code. */
export type VoiceProfileDraft = Omit<
  VoiceProfile,
  'handle' | 'displayName' | 'fromScripts' | 'reelCount' | 'builtAt'
>

export const VOICE_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    vocabulary: { type: 'array', items: { type: 'string' } },
    formality: { type: 'string' },
    sentenceRhythm: { type: 'string' },
    audienceAddress: { type: 'string' },
    toneDescriptors: { type: 'array', items: { type: 'string' } },
    hookHabits: { type: 'array', items: { type: 'string' } },
    emotionalRegister: { type: 'string' },
    structuralPattern: { type: 'string' },
    personaConsistencyScore: { type: 'integer' },
  },
  required: [
    'vocabulary', 'formality', 'sentenceRhythm', 'audienceAddress',
    'toneDescriptors', 'hookHabits', 'emotionalRegister', 'structuralPattern',
    'personaConsistencyScore',
  ],
}

export function buildVoiceProfilePrompt(
  handle: string,
  transcripts: string[],
  captions: string[],
): string {
  const transcriptBlock = transcripts.length
    ? transcripts.map((t, i) => `### Reel ${i + 1} transcript\n${t}`).join('\n\n')
    : '(no spoken transcripts available)'
  const captionBlock = captions.length
    ? captions.map((c, i) => `- ${c}`).join('\n')
    : '(no captions available)'

  return `You are a voice/tone analyst. Study how the creator @${handle} actually talks and writes, then distil a reusable VOICE PROFILE that someone could use to rewrite ANY script so it sounds like @${handle}.

Focus on HOW they communicate, not WHAT topics they cover:

1. **vocabulary** — signature words, phrases, slang, filler, or jargon they reuse (verbatim where possible).
2. **formality** — one phrase placing them on the casual↔polished axis.
3. **sentenceRhythm** — pacing: short punchy lines vs long flowing ones; typical opener length.
4. **audienceAddress** — do they say "you", "we", "guys", third person? How intimate/direct?
5. **toneDescriptors** — 3-6 adjectives for their overall vibe.
6. **hookHabits** — 3-5 recurring ways they OPEN a reel (templated, e.g. "POV: you just…").
7. **emotionalRegister** — the primary emotions and any arc (e.g. humour → urgency → reassurance).
8. **structuralPattern** — their usual hook → body → CTA shape, in one or two sentences.
9. **personaConsistencyScore** — 1-10: how consistent the voice is across the samples (10 = identical persona every reel).

## Spoken transcripts

${transcriptBlock}

## Captions

${captionBlock}

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

/** Coerce raw LLM output + attach code-owned fields. Never throws on bad shapes. */
export function parseVoiceProfile(
  raw: unknown,
  attach: { handle: string; displayName: string; reelCount: number; builtAt: number; fromScripts: boolean },
): VoiceProfile {
  const r = (raw ?? {}) as Record<string, unknown>
  const scoreNum = Number(r.personaConsistencyScore)
  const personaConsistencyScore = Number.isFinite(scoreNum)
    ? Math.min(10, Math.max(1, Math.round(scoreNum)))
    : 5
  return {
    ...attach,
    vocabulary: strArr(r.vocabulary),
    formality: str(r.formality),
    sentenceRhythm: str(r.sentenceRhythm),
    audienceAddress: str(r.audienceAddress),
    toneDescriptors: strArr(r.toneDescriptors),
    hookHabits: strArr(r.hookHabits),
    emotionalRegister: str(r.emotionalRegister),
    structuralPattern: str(r.structuralPattern),
    personaConsistencyScore,
  }
}
