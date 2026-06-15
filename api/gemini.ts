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

  // Shuffle keys and retry on 429 so a single hot key does not block the team.
  // Math.random() is fine here — this is load-balancing, not cryptography.
  const shuffled = [...keys].sort(() => Math.random() - 0.5)
  for (let i = 0; i < shuffled.length; i++) {
    const apiKey = shuffled[i]
    // Google AI Studio keys starting with AIza use the x-goog-api-key header.
    // Newer OAuth-style keys (AQ..., ya29...) require Authorization: Bearer.
    const authHeaders: Record<string, string> = apiKey.startsWith('AIza')
      ? { 'x-goog-api-key': apiKey }
      : { Authorization: `Bearer ${apiKey}` }
    const upstream = await fetch(`${GEMINI_BASE}/models/${model}:${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    })
    // On 429, try the next key if one is available; otherwise pass the 429 back.
    if (upstream.status === 429 && i < shuffled.length - 1) {
      await upstream.body?.cancel()
      continue
    }
    const text = await upstream.text()
    res.status(upstream.status).setHeader('Content-Type', 'application/json').end(text)
    return
  }
}
