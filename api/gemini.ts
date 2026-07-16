/**
 * POST /api/gemini — server-side Gemini proxy.
 *
 * Accepts: { model: string, endpoint?: string, body: Record<string, unknown> }
 * Gate: Clerk session JWT (Bearer token in Authorization header).
 * Key: GEMINI_API_KEY (+ GEMINI_KEYS comma-separated pool) from server env — never exposed to clients.
 *
 * Security properties:
 *   - Model allowlist: only gemini-* identifiers accepted.
 *   - Endpoint allowlist: generateContent / streamGenerateContent only.
 *   - Key failover: on 429, retries with a different key from the pool before returning.
 *   - Fails closed: missing keys → 500; missing/invalid Clerk token → 401.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './_lib/auth.js'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const ALLOWED_ENDPOINTS = new Set(['generateContent', 'streamGenerateContent'])
const ALLOWED_MODEL_RE = /^gemini-[\w.-]+$/

function getGeminiKeys(): string[] {
  return [
    ...String(process.env.GEMINI_API_KEY ?? '').split(','),
    ...String(process.env.GEMINI_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
}

/**
 * True when a non-OK Gemini body signals a bad API KEY (revoked / invalid / expired) rather than a
 * genuine bad prompt. A revoked key left in the pool returns 400 `API_KEY_INVALID` ("API key not
 * valid…") or a 403; we fail over past it instead of surfacing it, so one dead key can't
 * intermittently break requests for the team. Bounded to the key signal so a real bad-prompt 400
 * still passes straight back (no pointless retries across every key).
 */
export function isInvalidKeyError(body: string): boolean {
  const b = body.toLowerCase()
  return (
    b.includes('api_key_invalid') ||
    b.includes('api key not valid') ||
    b.includes('api key expired') ||
    b.includes('api key is invalid')
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await requireClerkUser(req, res)
  if (!user) return

  const keys = getGeminiKeys()
  if (keys.length === 0) {
    res.status(500).json({ error: 'Server not configured: no Gemini API key' })
    return
  }

  let model: string, endpoint: string, body: Record<string, unknown>
  try {
    const raw = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>
    model = String(raw.model ?? '')
    endpoint = String(raw.endpoint ?? 'generateContent')
    body = (raw.body ?? {}) as Record<string, unknown>
  } catch {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  if (!ALLOWED_MODEL_RE.test(model)) {
    res.status(400).json({ error: 'Invalid or missing model' })
    return
  }
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    res.status(400).json({ error: 'Invalid endpoint' })
    return
  }

  // Shuffle keys and fail over on a bad key so one rate-limited (429) OR revoked/invalid key sitting
  // in the pool can't intermittently fail requests for the team. Math.random() is fine here — this
  // is load-balancing, not cryptography.
  const shuffled = [...keys].sort(() => Math.random() - 0.5)
  for (let i = 0; i < shuffled.length; i++) {
    const apiKey = shuffled[i]
    const upstream = await fetch(`${GEMINI_BASE}/models/${model}:${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    })
    const hasMore = i < shuffled.length - 1
    // On 429 (rate-limited key), try the next key if one is available.
    if (upstream.status === 429 && hasMore) {
      await upstream.body?.cancel()
      continue
    }
    const text = await upstream.text()
    // A revoked/invalid key returns 400 API_KEY_INVALID (or a 403). Don't surface that to the user
    // while valid keys remain — roll to the next key. If EVERY key is bad, the final iteration
    // returns the error unchanged (so a truly missing/invalid config still reports honestly).
    if ((upstream.status === 400 || upstream.status === 403) && hasMore && isInvalidKeyError(text)) {
      continue
    }
    res.status(upstream.status).setHeader('Content-Type', 'application/json').end(text)
    return
  }
}
