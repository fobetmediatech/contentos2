/**
 * Chat file attachments — read a user-picked file into an inline base64 part
 * that Gemini reads natively (PDF / image / plain text). Ephemeral: the bytes
 * ride along on ONE agent turn and are never persisted to the conversation
 * store or the corpus.
 *
 * Word/Excel are intentionally excluded — Gemini can't read .docx/.xlsx inline,
 * they'd need a parser dependency. Add that path if someone actually needs it.
 */

export interface ChatAttachment {
  name: string
  /** MIME type sent to Gemini (inlineData.mimeType). */
  mimeType: string
  /** base64-encoded bytes, no `data:...;base64,` prefix. */
  data: string
  size: number
}

/** MIME types Gemini reads inline that we allow. */
const ACCEPTED = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'text/markdown',
])

/** Extension → MIME fallback: browsers often report '' or a wrong type for .md/.csv. */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
}

/** `accept` attribute for the <input type="file">. */
export const ACCEPT_ATTR =
  '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.md,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv,text/markdown'

/** Inline base64 requests must stay under ~20MB total; base64 inflates ~33%, so cap raw here. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * Resolve the MIME type to send to Gemini, or null if the file isn't accepted.
 * Pure — unit-testable without a real File/FileReader.
 */
export function resolveMimeType(name: string, type: string): string | null {
  if (ACCEPTED.has(type)) return type
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? null
}

/** Validate size + type. Returns a user-facing error string, or null if OK. */
export function validateAttachment(file: { name: string; type: string; size: number }): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `"${file.name}" is too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`
  }
  if (!resolveMimeType(file.name, file.type)) {
    return `"${file.name}" isn't a supported type. Upload a PDF, image, or text file.`
  }
  return null
}

/** Read a validated file into a ChatAttachment. Throws (with a user-facing message) if invalid. */
export async function readAttachment(file: File): Promise<ChatAttachment> {
  const err = validateAttachment(file)
  if (err) throw new Error(err)
  const mimeType = resolveMimeType(file.name, file.type)!
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',') // strip the `data:<mime>;base64,` prefix
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
  return { name: file.name, mimeType, data, size: file.size }
}
