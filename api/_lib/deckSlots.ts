/**
 * Deck AI slots (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * The 10 template slots a model has to write. The other 11 come from the brief and never touch a
 * model. 11 of the deck's 16 sections are fixed FOBET boilerplate and are not represented here at
 * all — this is slot filling, not deck generation.
 *
 * These keys are DUPLICATED from src/lib/deckTemplate.ts (AI_SLOTS), because that module imports
 * the .html through Vite's `?raw` and cannot be loaded by a serverless function. deckSlots.test.ts
 * asserts the two lists stay identical — the same guard pattern as the cb_ column-drift test, and
 * for the same reason: a silent divergence here means a slot is requested but never rendered.
 */

export const AI_SLOT_KEYS = [
  'positioningRole',
  'positioningOutcome',
  'positioningAudience',
  'buyerPain',
  'buyerObjection',
  'whatTheyAllDo',
  'theGap',
  'whoYouHelp',
  'proofLine',
  'freeResource',
] as const

export type AiSlotKey = (typeof AI_SLOT_KEYS)[number]

/** Per-slot instruction. Length matters — these render INLINE inside a sentence, not as paragraphs. */
const GUIDE: Record<AiSlotKey, string> = {
  positioningRole: 'A noun phrase for what they become known as. 2-5 words. e.g. "Dubai relocation advisor"',
  positioningOutcome: 'The concrete outcome they deliver. 3-8 words, verb-led. e.g. "handles the entire move end to end"',
  positioningAudience: 'Who it is for. 3-6 words. e.g. "HNI families moving from India"',
  buyerPain: 'The pain the buyer walks in with, in their own framing. 5-12 words.',
  buyerObjection: 'What stops them buying. 5-12 words.',
  whatTheyAllDo: 'What every competitor in this category is already doing. 5-12 words.',
  theGap: 'The specific gap nobody is filling — this is where we plant the flag. 5-15 words.',
  whoYouHelp: 'Instagram bio line 1: who you help, plain words, no adjectives. Under 60 characters.',
  proofLine: 'Instagram bio line 2: one proof point or credential. Under 60 characters.',
  freeResource: 'Instagram bio line 3: the free thing worth clicking. Under 60 characters.',
}

export const DECK_SLOT_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    AI_SLOT_KEYS.map((k) => [k, { type: 'string', nullable: true, description: GUIDE[k] }]),
  ),
  required: [...AI_SLOT_KEYS],
} as const

export const DECK_SLOT_PROMPT = `You are filling blanks in a content strategy deck for a client.

Each value is dropped INLINE into an existing sentence, so write PHRASES, not sentences. No
trailing full stops, no preamble, no markdown. Respect the length guide on each field.

IF YOU DO NOT KNOW, RETURN null. A blank renders as a visible dashed underline that tells the
strategist to write it themselves. A plausible invention renders as finished work and goes in front
of a client. Never invent a number, a credential, a client name or a result.

Write in LATIN script only. Romanise any Hindi as Hinglish; never output Devanagari.

Where an existing strategy document is provided, REUSE its language rather than re-deriving it —
the client may already have seen those words, and the deck should not contradict them.`

export interface SlotResult {
  slots: Partial<Record<AiSlotKey, string>>
  /** Slots the model declined. Reported so the caller can say how much is still blank. */
  blank: AiSlotKey[]
}

/**
 * Keep only known keys with usable values. Model output is untrusted: an unknown key would be
 * dropped silently by the template anyway, and an over-long value would break the inline layout.
 */
export function pickSlots(raw: unknown, maxChars = 160): SlotResult {
  const source = (raw ?? {}) as Record<string, unknown>
  const slots: Partial<Record<AiSlotKey, string>> = {}
  const blank: AiSlotKey[] = []

  for (const key of AI_SLOT_KEYS) {
    const v = source[key]
    const text = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
    // A model that ignores "return null" often returns the literal string instead.
    if (!text || text.toLowerCase() === 'null' || text.length > maxChars) {
      blank.push(key)
      continue
    }
    slots[key] = text
  }
  return { slots, blank }
}
