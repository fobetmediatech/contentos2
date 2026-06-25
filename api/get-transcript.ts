/**
 * POST /api/get-transcript — Vercel serverless (Node / Fluid Compute).
 *
 * Lightweight transcript-only extraction for ONE reel. The client scrapes the reel
 * (Apify, client-side) and posts the stable api.apify.com video URL + shortCode.
 * This function:
 *   gate(Clerk JWT) → SSRF-allowlist the video host → fetch bytes →
 *   Fast path  (≤15 MB): inline_data directly in generateContent — no upload, no polling.
 *   Slow path  (> 15 MB): Gemini Files API upload + ACTIVE poll (same as full analysis).
 *   → { transcript, segments }
 *
 * The inline path eliminates the Files API upload session + ACTIVE polling (~10-30s saved
 * for most reels). Base64 encoding adds ~33% overhead, so 15 MB video ≈ 20 MB request —
 * comfortably within Gemini's per-request cap. Larger videos fall back to Files API.
 *
 * One Gemini stage only (no synthesis/markdown). Self-contained ESM (no ../src imports).
 * Gate FAILS CLOSED. Same SSRF allowlist as analyze-single-reel.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { analyzeVideoWithGemini, GeminiFilesError } from './_lib/geminiFiles.js'
import {
  TRANSCRIPT_SCHEMA,
  buildTranscriptPrompt,
  coerceTranscript,
  type TranscriptResult,
} from './_lib/transcriptPrompt.js'
import { requireClerkUser } from './_lib/auth.js'

export const config = { maxDuration: 180 }

const ALLOWED_HOSTS = new Set(['api.apify.com'])
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
/** Videos at or below this size skip the Files API entirely — sent as base64 inline_data. */
const INLINE_THRESHOLD = 15 * 1024 * 1024

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const GEMINI_MODEL = 'gemini-2.5-flash'

function pickGeminiKey(): string {
  const keys = [
    ...String(process.env.GEMINI_API_KEY ?? '').split(','),
    ...String(process.env.GEMINI_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
  return keys[Math.floor(Math.random() * keys.length)] ?? ''
}

/**
 * Send video bytes to Gemini as base64 inline_data — no upload session, no polling.
 * Returns the parsed JSON object from the model response.
 */
async function transcribeInline(args: {
  bytes: ArrayBuffer
  mimeType: string
  apiKey: string
  prompt: string
  schema: unknown
}): Promise<unknown> {
  const { bytes, mimeType, apiKey, prompt, schema } = args
  const base64 = Buffer.from(bytes).toString('base64')
  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64 } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new HandlerError(`Gemini inline failed (${res.status})`, res.status)
  const parsed = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text
  if (!out) throw new HandlerError('Gemini returned no content', 502)
  return JSON.parse(out) as unknown
}

export interface GetTranscriptInput {
  downloadedVideoUrl: string
  shortCode: string
}

export class HandlerError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function getTranscript(input: GetTranscriptInput, geminiApiKey: string): Promise<TranscriptResult> {
  const { downloadedVideoUrl } = input

  let host: string
  try {
    host = new URL(downloadedVideoUrl).host
  } catch {
    throw new HandlerError('Invalid downloadedVideoUrl', 400)
  }
  if (!ALLOWED_HOSTS.has(host)) throw new HandlerError(`Host not allowed: ${host}`, 400)

  const res = await fetch(downloadedVideoUrl, { redirect: 'manual' })
  if (!res.ok) throw new HandlerError(`Video fetch failed (${res.status})`, 502)
  const contentType = (res.headers.get('content-type') || '').split(';')[0] || 'video/mp4'
  if (!/^(video\/|application\/octet-stream)/i.test(contentType)) {
    throw new HandlerError(`Unexpected content-type: ${contentType}`, 422)
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw new HandlerError('Empty video body', 502)
  if (buf.byteLength > MAX_VIDEO_BYTES) throw new HandlerError('Video too large', 413)

  const mimeType = contentType.startsWith('video/') ? contentType : 'video/mp4'
  const prompt = buildTranscriptPrompt()

  let data: unknown
  if (buf.byteLength <= INLINE_THRESHOLD) {
    // Fast path: base64 inline — no upload session, no ACTIVE polling.
    data = await transcribeInline({ bytes: buf, mimeType, apiKey: geminiApiKey, prompt, schema: TRANSCRIPT_SCHEMA })
  } else {
    // Slow path: Files API for videos > 15 MB.
    const result = await analyzeVideoWithGemini({ bytes: buf, mimeType, apiKey: geminiApiKey, prompt, schema: TRANSCRIPT_SCHEMA })
    data = result.data
  }

  return coerceTranscript(data)
}

function parseBody(raw: unknown): Partial<GetTranscriptInput> {
  if (raw && typeof raw === 'object') return raw as Partial<GetTranscriptInput>
  if (typeof raw === 'string' && raw.length > 0) return JSON.parse(raw) as Partial<GetTranscriptInput>
  return {}
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const user = await requireClerkUser(req, res)
  if (!user) return

  const geminiApiKey = pickGeminiKey()
  if (!geminiApiKey) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  let input: GetTranscriptInput
  try {
    const body = parseBody(req.body)
    if (!body.downloadedVideoUrl || !body.shortCode) {
      res.status(400).json({ error: 'downloadedVideoUrl and shortCode are required' })
      return
    }
    input = { downloadedVideoUrl: body.downloadedVideoUrl, shortCode: body.shortCode }
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  try {
    const result = await getTranscript(input, geminiApiKey)
    res.status(200).json({ shortCode: input.shortCode, result })
  } catch (err) {
    const known = err instanceof HandlerError || err instanceof GeminiFilesError
    res.status(known ? (err as { status: number }).status : 500).json({
      error: known ? (err as Error).message : 'Transcription failed',
    })
  }
}
