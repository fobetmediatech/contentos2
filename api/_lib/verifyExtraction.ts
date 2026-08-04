/**
 * Extraction verification (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Pure: model output + the chunks we actually sent → rows ready for cb_extractions. No I/O, so it
 * is unit-tested directly.
 *
 * This is what makes provenance mean something. A model asked for a verbatim quote will sometimes
 * paraphrase, or cite a chunk id it never saw. Both are invisible downstream — the review UI shows
 * a citation, a human clicks through, and the quote does not match what was said. Worse, it looks
 * exactly like a real citation while doing so.
 *
 * So every citation is checked against the source text before it can be stored:
 *   (a) chunk_id must be one we actually sent (no invented ids), and
 *   (b) the quote must appear VERBATIM in that chunk, whitespace-insensitively.
 *
 * Failing citations are dropped. An 'extracted' field left with none has its value forced to null —
 * the same rule the database enforces, applied early so the caller gets a count rather than a
 * constraint violation.
 */

export interface SourceChunk {
  id: string
  text: string
}

export interface ModelCitation {
  chunk_id?: unknown
  quote?: unknown
  start_sec?: unknown
}

export interface ModelField {
  field_name?: unknown
  value?: unknown
  provenance?: unknown
  confidence?: unknown
  citations?: unknown
}

export interface VerifiedCitation {
  chunk_id: string
  quote: string
  start_sec: number | null
}

export interface VerifiedField {
  field_name: string
  value: string | null
  citations: VerifiedCitation[]
  provenance: 'extracted' | 'inferred'
  confidence: number | null
}

export interface VerifyResult {
  fields: VerifiedField[]
  /** Citations rejected as unverifiable (bad id, or the quote is not in the chunk). */
  droppedCitations: number
  /** 'extracted' values nulled because nothing survived verification to back them. */
  forcedNull: number
  /** Fields the model returned that were not in the allowed set. */
  rejectedFields: number
}

/** Whitespace-insensitive so a line wrap inside a chunk never fails an otherwise exact quote. */
const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

export function verifyExtraction(
  modelFields: unknown,
  chunks: SourceChunk[],
  allowedFields: readonly string[],
): VerifyResult {
  const byId = new Map(chunks.map((c) => [c.id, normalise(c.text)]))
  const allowed = new Set(allowedFields)

  let droppedCitations = 0
  let forcedNull = 0
  let rejectedFields = 0

  const input = Array.isArray(modelFields) ? (modelFields as ModelField[]) : []
  const fields: VerifiedField[] = []

  for (const f of input) {
    const name = typeof f?.field_name === 'string' ? f.field_name : ''
    if (!allowed.has(name)) {
      // Includes handle fields, which the model must never author.
      if (name) rejectedFields++
      continue
    }

    const provenance: 'extracted' | 'inferred' = f.provenance === 'inferred' ? 'inferred' : 'extracted'
    let value = typeof f.value === 'string' && f.value.trim() ? f.value.trim() : null

    const raw = Array.isArray(f.citations) ? (f.citations as ModelCitation[]) : []
    const citations: VerifiedCitation[] = []
    for (const c of raw) {
      const id = typeof c?.chunk_id === 'string' ? c.chunk_id : ''
      const quote = typeof c?.quote === 'string' ? c.quote.trim() : ''
      const chunkText = byId.get(id)
      if (!chunkText || !quote || !chunkText.includes(normalise(quote))) {
        droppedCitations++
        continue
      }
      citations.push({
        chunk_id: id,
        quote,
        start_sec: typeof c.start_sec === 'number' ? c.start_sec : null,
      })
    }

    if (provenance === 'extracted' && value !== null && citations.length === 0) {
      value = null
      forcedNull++
    }

    const rawConfidence = typeof f.confidence === 'number' ? f.confidence : null
    const confidence =
      provenance === 'inferred' && value !== null
        ? Math.min(1, Math.max(0, rawConfidence ?? 0.5))
        : null

    fields.push({ field_name: name, value, citations, provenance, confidence })
  }

  return { fields, droppedCitations, forcedNull, rejectedFields }
}
