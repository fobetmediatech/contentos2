/**
 * Brief extraction prompt + schema (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Turns onboarding-call chunks into StrategyBrief field values, each carrying its own citations.
 * The model emits JSON against a fixed schema. It never emits markup, and it never writes into the
 * deck — the output lands in cb_extractions for a human to review.
 *
 * WHAT THE MODEL MAY WRITE: only the 9 scalar brief fields below.
 * competitors.0-4 / aspirational.0-3 are EXCLUDED by design — handles come from the sales sheet
 * (provenance 'sheet'), because clients do not name Instagram handles on a call ("there's a guy in
 * Sector 57 doing well" is not a handle). The database enforces this too: a handle field cannot
 * carry a model-authored provenance. `theme` is presentation-only and never extracted.
 */

/** The fields the model is allowed to produce. Must stay a subset of cb_extractions.field_name. */
export const EXTRACTABLE_FIELDS = [
  'brandName',
  'primaryNiche',
  'subNiche',
  'offer',
  'language',
  'audience',
  'brandColors',
  'dislikes',
  'offLimits',
] as const

export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number]

/** Per-field instruction. Kept beside the schema so the two cannot drift apart. */
const FIELD_GUIDE: Record<ExtractableField, string> = {
  brandName: 'What the brand/client is called on screen. Usually stated in the introductions.',
  primaryNiche: 'The broad category they operate in (e.g. "Real estate + Dubai consultancy").',
  subNiche: 'The exact speciality inside that category (e.g. "Visas, schools, compliance").',
  offer: 'The ONE thing being sold — the offer every piece of content should drive toward. If they named several, pick the one they described as the main revenue driver and quote it.',
  language: 'One of exactly: english | hindi | hinglish. Base this on the language they say their AUDIENCE consumes content in, not the language of this call. If never discussed, return null.',
  audience: 'Who the customer is: age, income level, biggest problem, and what they want. These are usually said at DIFFERENT points in the call — cite every moment you drew from, not just one.',
  brandColors: 'Brand colours, as hex codes or names, only if actually stated.',
  dislikes: 'Topics, formats or styles the client said they dislike or do not want (e.g. "no cringe skits").',
  offLimits: 'Topics that are legally or reputationally off-limits — compliance constraints, regulated claims, anything they said must never be published.',
}

/**
 * Gemini responseSchema. Structured output only — validation happens at the API layer so the model
 * retries on a mismatch instead of us parsing prose.
 */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field_name: { type: 'string', enum: [...EXTRACTABLE_FIELDS] },
          value: {
            type: 'string',
            nullable: true,
            description: 'The extracted value, or null if the client never said it.',
          },
          provenance: { type: 'string', enum: ['extracted', 'inferred'] },
          confidence: {
            type: 'number',
            nullable: true,
            description: 'Required for inferred, 0-1. Null for extracted.',
          },
          citations: {
            type: 'array',
            description: 'Every moment this value was drawn from. Required when provenance is extracted and value is non-null.',
            items: {
              type: 'object',
              properties: {
                chunk_id: { type: 'string' },
                quote: { type: 'string', description: 'VERBATIM from the chunk. Never paraphrased.' },
                start_sec: { type: 'number', nullable: true },
              },
              required: ['chunk_id', 'quote'],
            },
          },
        },
        required: ['field_name', 'value', 'provenance', 'citations'],
      },
    },
  },
  required: ['fields'],
} as const

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured onboarding facts from a client call transcript.

You are given numbered transcript chunks. Each chunk has an id, a speaker, and a timestamp.
Return ONE entry per requested field. Never return markup. Never return commentary.

THE CARDINAL RULE — IF THE CLIENT DID NOT SAY IT, RETURN null.
Do not infer a plausible value for an 'extracted' field. An empty field is honest and a human
fills it in ten seconds. A confidently wrong offer or ticket size survives into a client meeting.

PROVENANCE — classify every field as exactly one of:
  • "extracted" — the client stated it. REQUIRES at least one citation with a chunk_id and a
    VERBATIM quote copied character-for-character from that chunk. Never paraphrase a quote.
    If you cannot produce a real quote, the value is not extracted — return null.
  • "inferred"  — your judgment rather than their words (positioning, tone, audience read).
    REQUIRES a confidence score between 0 and 1. Cite the chunks that informed the judgment.
    Use this sparingly and never for a fact the client could simply have stated.

MULTI-SOURCE IS NORMAL. A field like 'audience' is usually assembled from several separate moments
across the call. Cite ALL of them. Do not pick one chunk and imply it was the whole basis.

COMPLIANCE FIELDS — 'offLimits' and 'dislikes' are the highest-consequence fields here. A miss
means shooting content the client legally cannot publish. If the topic WAS discussed and there are
genuinely no constraints, return the literal string "none stated" with provenance "extracted" and a
citation showing it was asked. Return null ONLY when the topic never came up at all. A reviewer
must be able to tell "we asked and there are none" apart from "we never asked".

SCRIPT — write every value in LATIN script only. Romanise any Hindi into Hinglish
("Par main aapse kyun lun"), never Devanagari. This applies to quotes as well: if the speaker used
Devanagari, romanise it in the quote field while keeping the words exactly as spoken.

You may READ any numbers, metrics or scraped figures present, but never invent or restate them as
your own value. Do not produce competitor or aspirational handles — those come from elsewhere.`

/** Build the user payload: the field list with guidance, plus the chunks to read. */
export function buildExtractionPayload(
  chunks: Array<{ id: string; speaker: string | null; startSec: number | null; text: string }>,
): string {
  const fieldList = EXTRACTABLE_FIELDS.map((f) => `- ${f}: ${FIELD_GUIDE[f]}`).join('\n')
  const body = chunks
    .map(
      (c) =>
        `[chunk_id: ${c.id}${c.startSec != null ? ` | t=${c.startSec}s` : ''}${c.speaker ? ` | speaker: ${c.speaker}` : ''}]\n${c.text}`,
    )
    .join('\n\n')

  return `FIELDS TO EXTRACT (return one entry for each, even if the value is null):
${fieldList}

TRANSCRIPT CHUNKS — quote only from these, and cite the chunk_id you quoted from:

${body}`
}
