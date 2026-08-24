/**
 * Plain meeting summary — prompt, response schema, and a normaliser (SERVER-SIDE, ESM,
 * self-contained).
 *
 * This is the unstyled counterpart to the FOBET deck: minutes a human can read and print.
 *
 * The normaliser exists because responseSchema constrains the model without making its output
 * trustworthy — MAX_TOKENS and safety filtering can still truncate a response into a partial object.
 * That value goes straight into a jsonb column and is then rendered by the print page, so malformed
 * entries are dropped once, here, rather than crashing a print view later.
 *
 * Timestamps are `m:ss`, matching fmtTime in handlerAsk.ts. A MISSING timestamp becomes an empty
 * string, never a guess: a fabricated timestamp in printed minutes is worse than an absent one,
 * because it looks verifiable.
 */

/** Deliberate cap. A 60-minute call is far inside the model's context; an unbounded slice is how one
 *  runaway row turns a request into a timeout. */
const MAX_TRANSCRIPT_CHARS = 200_000

export interface SummaryItem {
  text: string
  timestamp: string
}

export interface ActionItem {
  text: string
  owner: string | null
  timestamp: string
}

export interface KeyNumber {
  label: string
  value: string
  timestamp: string
}

export interface MeetingSummary {
  discussion: SummaryItem[]
  decisions: SummaryItem[]
  actionItems: ActionItem[]
  keyNumbers: KeyNumber[]
}

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    discussion: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, timestamp: { type: 'string' } },
        required: ['text', 'timestamp'],
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, timestamp: { type: 'string' } },
        required: ['text', 'timestamp'],
      },
    },
    action_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          owner: { type: 'string', nullable: true },
          timestamp: { type: 'string' },
        },
        required: ['text', 'timestamp'],
      },
    },
    key_numbers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          timestamp: { type: 'string' },
        },
        required: ['label', 'value', 'timestamp'],
      },
    },
  },
  required: ['discussion', 'decisions', 'action_items', 'key_numbers'],
} as const

const SYSTEM = `You write plain, factual minutes for a client call, using ONLY the transcript below.

RULES:
- Never invent a number, date, name or commitment. If a figure is not stated in the transcript, it
  does not exist. These minutes get printed and sent; an invented figure is worse than a gap.
- Give every entry a timestamp in m:ss form, taken from the transcript. If you cannot locate one,
  use an empty string — do NOT guess.
- action_items: only things someone actually committed to. owner is the person named, or null.
- key_numbers: figures the client stated — budget, retainer, ticket size, timelines, volumes.
- Be brief. Prefer the client's own phrasing.
- Write in LATIN script only. Romanise any Hindi as Hinglish; never output Devanagari.`

export function buildSummaryPrompt(title: string | null, fullText: string): string {
  return `${SYSTEM}\n\nMEETING: ${title ?? 'Untitled call'}\n\nTRANSCRIPT:\n${fullText.slice(0, MAX_TRANSCRIPT_CHARS)}`
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    : []

/** Drop anything without content; never fabricate a timestamp or an owner. */
export function normaliseSummary(raw: unknown): MeetingSummary {
  const r = (Boolean(raw) && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const items = (v: unknown): SummaryItem[] =>
    arr(v)
      .map((x) => ({ text: str(x.text), timestamp: str(x.timestamp) }))
      .filter((x) => x.text !== '')

  return {
    discussion: items(r.discussion),
    decisions: items(r.decisions),
    // The model emits snake_case per SUMMARY_SCHEMA, but the normalised camelCase result returned
    // here is what handlerSummary.ts caches into cb_transcripts.summary. A cached read runs that
    // stored object back through this same function, so it must accept both spellings to be
    // idempotent across a store-and-reload round trip — otherwise every cached row loses these two
    // sections on the second view, since only snake_case was ever recognised.
    actionItems: arr(r.action_items ?? r.actionItems)
      .map((x) => ({ text: str(x.text), owner: str(x.owner) || null, timestamp: str(x.timestamp) }))
      .filter((x) => x.text !== ''),
    keyNumbers: arr(r.key_numbers ?? r.keyNumbers)
      .map((x) => ({ label: str(x.label), value: str(x.value), timestamp: str(x.timestamp) }))
      // Both halves required: a label with no figure ("Monthly retainer: ") prints as an empty
      // promise on a document that gets sent to the client. Every other section likewise drops
      // entries with no content.
      .filter((x) => x.label !== '' && x.value !== ''),
  }
}
