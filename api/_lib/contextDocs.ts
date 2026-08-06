/**
 * Context documents for extraction (SERVER-SIDE, ESM, self-contained).
 *
 * Files go STRAIGHT TO GEMINI rather than being parsed here. That is the whole point of the
 * multimodal path: no PDF/DOCX/PPTX/XLSX parsing libraries, no layout-destroying text extraction,
 * and slides and spreadsheets keep the structure that makes them readable.
 *
 * ponytail: 4 MB total cap because a Vercel function body tops out around 4.5 MB. Above that the
 * upgrade path is a direct browser→Gemini resumable upload with the server only minting the URL —
 * more moving parts, so not until someone actually hits the ceiling.
 */
import { uploadFileToGemini, GeminiFilesError } from './geminiFiles.js'

export const MAX_DOC_BYTES = 4 * 1024 * 1024
export const MAX_DOCS = 5

export interface IncomingDoc {
  name: string
  mimeType: string
  /** base64, no data: prefix. */
  data: string
}

export interface DocPart {
  file_data: { mime_type: string; file_uri: string }
}

/** Formats Gemini reads natively. Anything else is rejected loudly rather than silently ignored. */
const ALLOWED = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
])

export class ContextDocError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ContextDocError'
    this.status = status
  }
}

/** Validate + decode. Pure enough to unit-test; no network. */
export function decodeDocs(input: unknown): Array<{ name: string; mimeType: string; bytes: ArrayBuffer }> {
  if (!Array.isArray(input) || input.length === 0) return []
  if (input.length > MAX_DOCS) throw new ContextDocError(`At most ${MAX_DOCS} documents per run`)

  let total = 0
  return (input as IncomingDoc[]).map((d) => {
    const name = typeof d?.name === 'string' ? d.name.trim() : ''
    const mimeType = typeof d?.mimeType === 'string' ? d.mimeType.trim() : ''
    const data = typeof d?.data === 'string' ? d.data : ''
    if (!name || !data) throw new ContextDocError('Each document needs a name and data')
    if (!ALLOWED.has(mimeType)) throw new ContextDocError(`Unsupported file type: ${mimeType || 'unknown'}`)

    const bytes = Buffer.from(data, 'base64')
    total += bytes.byteLength
    if (total > MAX_DOC_BYTES) {
      throw new ContextDocError(`Documents exceed the ${Math.round(MAX_DOC_BYTES / 1024 / 1024)} MB total limit`)
    }
    // Copy into a standalone ArrayBuffer — Buffer views share a pooled backing store.
    const copy = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(copy).set(bytes)
    return { name, mimeType, bytes: copy }
  })
}

/** Upload decoded docs and return generateContent parts. Order is preserved. */
export async function uploadDocs(
  docs: Array<{ name: string; mimeType: string; bytes: ArrayBuffer }>,
  apiKey: string,
): Promise<DocPart[]> {
  const parts: DocPart[] = []
  for (const doc of docs) {
    try {
      const file = await uploadFileToGemini({
        bytes: doc.bytes,
        mimeType: doc.mimeType,
        apiKey,
        displayName: doc.name,
      })
      parts.push({ file_data: { mime_type: doc.mimeType, file_uri: file.uri } })
    } catch (err) {
      // Fail the run rather than quietly extracting from fewer documents than the user attached —
      // a partial context looks identical to a complete one in the output.
      const status = err instanceof GeminiFilesError ? err.status : 502
      throw new ContextDocError(`Could not read "${doc.name}"`, status)
    }
  }
  return parts
}
