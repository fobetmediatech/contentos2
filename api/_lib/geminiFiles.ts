/**
 * Gemini Files API client (SERVER-SIDE — runs inside the Vercel function).
 *
 * The browser path (src/ai/gemini.ts) is text-only and exposes the key in the
 * bundle. This module does the multimodal video path that requires a backend:
 *   resumable upload of video bytes -> poll until ACTIVE -> generateContent with
 *   the file + a responseSchema -> delete the uploaded file.
 *
 * Ported from the Phase-0 spike (spike/r1-v2.mjs), which proved the flow on a
 * real reel in ~18s. Pure + dependency-free so it unit-tests with a mocked
 * global fetch.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-2.5-flash'

export class GeminiFilesError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GeminiFilesError'
    this.status = status
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface FileResource {
  name: string
  uri: string
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED' | string
}

export interface AnalyzeVideoArgs {
  bytes: Uint8Array
  mimeType: string
  apiKey: string
  prompt: string
  schema: unknown
  model?: string
  /** Max ms to wait for the uploaded file to become ACTIVE (default 120s). */
  activeTimeoutMs?: number
}

export interface AnalyzeVideoResult {
  /** Parsed JSON object from the model (responseMimeType=application/json). */
  data: unknown
  /** Raw usageMetadata from Gemini (token accounting). */
  usage: unknown
}

/**
 * Upload video bytes to the Gemini Files API, wait until ACTIVE, run a
 * multimodal generateContent with the given prompt + responseSchema, and
 * always attempt to delete the uploaded file afterward.
 *
 * Throws GeminiFilesError (with an HTTP-ish status) on any step failure so the
 * handler can map it to a clean response. Never leaks the API key in messages.
 */
export async function analyzeVideoWithGemini(args: AnalyzeVideoArgs): Promise<AnalyzeVideoResult> {
  const { bytes, mimeType, apiKey, prompt, schema } = args
  const model = args.model ?? DEFAULT_MODEL
  const activeTimeoutMs = args.activeTimeoutMs ?? 120_000
  const numBytes = bytes.byteLength

  // 1) start resumable upload session
  const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(numBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'reel' } }),
  })
  if (!start.ok) throw new GeminiFilesError(`Files API start failed (${start.status})`, start.status)
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new GeminiFilesError('Files API did not return an upload URL', 502)

  // 2) upload bytes + finalize
  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(numBytes),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  })
  if (!up.ok) throw new GeminiFilesError(`Files API upload failed (${up.status})`, up.status)
  let file = ((await up.json()) as { file: FileResource }).file

  try {
    // 3) poll until ACTIVE
    const deadline = Date.now() + activeTimeoutMs
    while (file.state === 'PROCESSING') {
      if (Date.now() > deadline) throw new GeminiFilesError('Uploaded file never became ACTIVE (timeout)', 504)
      await sleep(2000)
      const poll = await fetch(`${GEMINI_BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': apiKey } })
      if (!poll.ok) throw new GeminiFilesError(`Files API poll failed (${poll.status})`, poll.status)
      file = (await poll.json()) as FileResource
    }
    if (file.state !== 'ACTIVE') throw new GeminiFilesError(`Uploaded file is ${file.state}, not ACTIVE`, 502)

    // 4) generateContent with the file + responseSchema
    const gen = await fetch(`${GEMINI_BASE}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ file_data: { mime_type: mimeType, file_uri: file.uri } }, { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
    })
    const genText = await gen.text()
    if (!gen.ok) throw new GeminiFilesError(`generateContent failed (${gen.status})`, gen.status)

    const parsed = JSON.parse(genText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: unknown
    }
    const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text
    if (!out) throw new GeminiFilesError('generateContent returned no content', 502)

    let data: unknown
    try {
      data = JSON.parse(out)
    } catch {
      throw new GeminiFilesError('Model returned non-JSON content', 502)
    }
    return { data, usage: parsed.usageMetadata ?? null }
  } finally {
    // 5) best-effort cleanup — never let a failed delete mask the real result/error
    void fetch(`${GEMINI_BASE}/v1beta/${file.name}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': apiKey },
    }).catch(() => {})
  }
}
