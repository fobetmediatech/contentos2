/**
 * Gemini embeddings (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Model + dimension are pinned here and STAMPED onto every row (cb_transcript_chunks.embedding_model),
 * because a model switch silently invalidates similarity against older vectors. text-embedding-004
 * was deprecated on 2026-01-14; assume this one will be superseded too.
 *
 * 768 rather than the 3072 default, for two reasons:
 *   - gemini-embedding-2 AUTO-normalises truncated dimensions (its predecessor required manual
 *     normalisation, and an unnormalised vector makes cosine distance quietly wrong, not loud).
 *   - pgvector caps hnsw/ivfflat indexes at 2000 dims for the `vector` type, so 3072 would force
 *     halfvec. 768 keeps a plain HNSW index.
 *
 * taskType is not cosmetic: documents and queries are embedded into deliberately different spaces,
 * so storing chunks as RETRIEVAL_DOCUMENT and searching with RETRIEVAL_QUERY measurably improves
 * retrieval over using one for both.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'

export const EMBED_MODEL = 'gemini-embedding-2'
export const EMBED_DIMS = 768

/** Keeps request bodies well clear of payload limits; tune only with a reason. */
const BATCH_SIZE = 50

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'

export class EmbedError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'EmbedError'
    this.status = status
  }
}

interface EmbedResponse {
  embeddings?: Array<{ values?: number[] }>
}

/**
 * Embed many texts, preserving order. Returns one vector per input.
 * Throws rather than returning partial results — a half-embedded transcript would look complete
 * in the database while silently missing chunks from every search.
 */
export async function embedTexts(
  texts: string[],
  apiKey: string,
  taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT',
): Promise<number[][]> {
  if (texts.length === 0) return []

  const out: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const res = await fetch(`${GEMINI_BASE}/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBED_DIMS,
          taskType,
        })),
      }),
    })

    if (!res.ok) {
      // Never include the response body — it can echo the key back in an auth error.
      throw new EmbedError(`embedding failed (${res.status})`, res.status)
    }

    const body = (await res.json()) as EmbedResponse
    const vectors = body.embeddings ?? []
    if (vectors.length !== batch.length) {
      throw new EmbedError(`embedding count mismatch: ${vectors.length} for ${batch.length}`, 502)
    }
    for (const v of vectors) {
      const values = v?.values ?? []
      if (values.length !== EMBED_DIMS) {
        throw new EmbedError(`expected ${EMBED_DIMS} dims, got ${values.length}`, 502)
      }
      out.push(values)
    }
  }

  return out
}

/** pgvector accepts a bracketed literal over the REST API: "[0.1,0.2,...]". */
export const toVectorLiteral = (v: number[]): string => `[${v.join(',')}]`
