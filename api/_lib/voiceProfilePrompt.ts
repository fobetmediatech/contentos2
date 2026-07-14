// COPY of src/ai/prompts/voiceProfile.ts, plus pickExemplars copied from src/lib/repurposeHelpers.ts
// (a different source file) — api/ can't import src/. Keep in sync: the drift test
// (voiceProfilePrompt.test.ts) cross-checks VERSION + SCHEMA + buildVoiceProfilePrompt against
// src/ai/prompts/voiceProfile.ts, and pickExemplars against src/lib/repurposeHelpers.ts.
// src/ai/prompts/voiceProfile.ts
/**
 * Voice Profile — prompt + schema + type for synthesizing a client's reel voice.
 *
 * Mirrors creatorHookSummary.ts: the LLM produces the qualitative half; handle/displayName/
 * reelCount/builtAt/fromScripts are attached in code (parseVoiceProfile). Consumed by
 * useRepurposeReel (build) and the rewrite prompt (reelRewrite.ts).
 */

export const VOICE_PROFILE_PROMPT_VERSION = 3

/** User-set output-language override for repurposed scripts (Memory → Voices). */
export type VoiceLanguageMode = 'auto' | 'english' | 'hinglish'

export interface VoiceProfile {
  handle: string
  displayName: string
  fromScripts: boolean
  /**
   * User override for the repurposed OUTPUT language, set in Memory → Voices. 'auto' (or
   * undefined, for profiles built before this existed) = detect from the `language` field +
   * exemplars; 'english' / 'hinglish' force that language regardless of what detection says.
   * Code-owned — never produced by the LLM, so it is absent from VOICE_PROFILE_SCHEMA.
   */
  outputLanguage?: VoiceLanguageMode
  vocabulary: string[]
  /**
   * The language + English↔Hindi balance the creator ACTUALLY uses (e.g. "English", "mostly English
   * with occasional Hindi words", "heavy Hinglish"). Anchors the rewrite's output language so a
   * mostly-English creator isn't collapsed into full Hinglish. Optional for back-compat with profiles
   * built before this field existed (those fall back to ratio-matching on the exemplars).
   */
  language?: string
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
  /**
   * 2–4 verbatim opener lines from the client's REAL content (reels/scripts). The rewrite prompt
   * few-shots on these so it imitates actual cadence instead of an abstract description — the main
   * fix for "AI slop". Code-attached (not LLM output); optional so older cached profiles still load.
   */
  exemplars?: string[]
}

/** The qualitative half the LLM returns; the rest is attached in code. */
export type VoiceProfileDraft = Omit<
  VoiceProfile,
  'handle' | 'displayName' | 'fromScripts' | 'reelCount' | 'builtAt' | 'exemplars'
>

export const VOICE_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    vocabulary: { type: 'array', items: { type: 'string' } },
    language: { type: 'string' },
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
    'vocabulary', 'language', 'formality', 'sentenceRhythm', 'audienceAddress',
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
    ? captions.map((c) => `- ${c}`).join('\n')
    : '(no captions available)'

  return `You are a voice/tone analyst. Study how the creator @${handle} actually talks and writes, then distil a reusable VOICE PROFILE that someone could use to rewrite ANY script so it sounds like @${handle}.

LANGUAGE & SCRIPT (strict): write every field value in Latin/Roman script only. Romanize any Hindi/Indian-language words as Hinglish ("bhai aaj kuch alag karte hain", NOT Devanagari); keep English as English. NEVER use Devanagari or any non-Latin script.

Focus on HOW they communicate, not WHAT topics they cover:

1. **vocabulary** — signature words, phrases, slang, filler, or jargon they reuse (verbatim where possible).
2. **language** — the language(s) they speak and the English↔Hindi balance, stated as a precise ratio: e.g. "English", "mostly English with occasional Hindi words", "roughly half-and-half Hinglish", "heavy Hinglish". This decides what language their repurposed scripts come out in, so be accurate — do NOT label a mostly-English creator "Hinglish". Judge from how the SAMPLES actually read, not from the creator being Indian.
3. **formality** — one phrase placing them on the casual↔polished axis.
4. **sentenceRhythm** — pacing: short punchy lines vs long flowing ones; typical opener length.
5. **audienceAddress** — do they say "you", "we", "guys", third person? How intimate/direct?
6. **toneDescriptors** — 3-6 adjectives for their overall vibe.
7. **hookHabits** — 3-5 recurring ways they OPEN a reel (templated, e.g. "POV: you just…").
8. **emotionalRegister** — the primary emotions and any arc (e.g. humour → urgency → reassurance).
9. **structuralPattern** — their usual hook → body → CTA shape, in one or two sentences.
10. **personaConsistencyScore** — 1-10: how consistent the voice is across the samples (10 = identical persona every reel).

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
  attach: { handle: string; displayName: string; reelCount: number; builtAt: number; fromScripts: boolean; exemplars?: string[] },
): VoiceProfile {
  const r = (raw ?? {}) as Record<string, unknown>
  const scoreNum = Number(r.personaConsistencyScore)
  const personaConsistencyScore = Number.isFinite(scoreNum)
    ? Math.min(10, Math.max(1, Math.round(scoreNum)))
    : 5
  return {
    ...attach,
    vocabulary: strArr(r.vocabulary),
    language: str(r.language),
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

const EXEMPLAR_MAX_CHARS = 180

/**
 * Pull 2–4 short VERBATIM opener lines from the client's real samples (reel transcripts or pasted
 * scripts) to few-shot the rewrite. Openers carry the most voice signal (that's the hook), so we
 * take the first 1–2 sentences of each sample, trim, dedup, and cap. Pure + unit-tested.
 */
export function pickExemplars(samples: string[], max = 4): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of samples) {
    const clean = (s ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    // First 1–2 sentences; fall back to a leading chunk when there's no sentence punctuation.
    const m = clean.match(/^.*?[.!?](?:\s+.*?[.!?])?/)
    let line = (m ? m[0] : clean).trim()
    if (line.length < 12) line = clean // too short to be characteristic → keep the whole sample
    line = line.slice(0, EXEMPLAR_MAX_CHARS).trim()
    const key = line.toLowerCase()
    if (line && !seen.has(key)) {
      seen.add(key)
      out.push(line)
      if (out.length >= max) break
    }
  }
  return out
}
