/**
 * Transcript-only prompt (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Single Gemini stage: upload video → transcribe audio → return timestamped segments.
 * No video mechanics, no hook analysis, no case-study synthesis — transcript only.
 */

/** Bump when the prompt changes so transcriptCache lazily invalidates. */
export const TRANSCRIPT_PROMPT_VERSION = 3

export interface TranscriptSegment {
  start: number // seconds
  text: string
}

export interface TranscriptResult {
  transcript: string
  segments: TranscriptSegment[]
}

export const TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { start: { type: 'number' }, text: { type: 'string' } },
        required: ['start', 'text'],
      },
    },
  },
  required: ['transcript', 'segments'],
} as const

export function buildTranscriptPrompt(): string {
  return `Transcribe all spoken words in this video. Return ONLY JSON matching the schema — no prose, no code fences.

transcript — the FULL spoken audio, transcribed VERBATIM. Return "" if there is no speech.
segments — the transcript split into short timestamped chunks: [{ "start": <seconds, number>, "text": "<words in that chunk>" }]. Keep chunks to roughly one sentence. "start" is the second the chunk begins. Return [] if there is no speech.

CRITICAL — Latin script ONLY, no exceptions: You MUST write every single word in Roman/Latin letters. If the speaker speaks Hindi or any other Indic language, transliterate phonetically into English letters exactly as spoken (e.g. "aaj maine bahut achha product try kiya", "yaar sun", "kya hua"). NEVER output Devanagari, Arabic, or any non-Latin character — not even a single character. English words stay as-is.

Transcribe only what is actually said — do not paraphrase, summarise, or invent.`
}

export function coerceTranscript(raw: unknown): TranscriptResult {
  const o = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown, f = ''): string => (typeof v === 'string' ? v : f)
  const rawSegs = Array.isArray(o.segments) ? (o.segments as unknown[]) : []
  const segments: TranscriptSegment[] = rawSegs.map((s) => {
    const seg = (s ?? {}) as Record<string, unknown>
    return {
      start: Number.isFinite(Number(seg.start)) ? Number(seg.start) : 0,
      text: str(seg.text),
    }
  })
  return { transcript: str(o.transcript), segments }
}
