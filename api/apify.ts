/**
 * POST /api/apify — server-side Apify proxy.
 *
 * Accepts: { operation: 'start'|'poll'|'fetch', ...params }
 *   start:  { actorId: string, input: Record<string,unknown> }
 *   poll:   { runId: string }
 *   fetch:  { datasetId: string }
 *
 * Gate: Clerk session JWT (Bearer token in Authorization header).
 * Key: APIFY_KEY_1..10 (numbered) and/or APIFY_KEYS (comma-separated) from server env.
 *
 * Security properties:
 *   - Actor allowlist: only the 4 Instagram actors used by this product.
 *   - Fails closed: missing keys → 500; missing/invalid token → 401.
 *   - Random key selection per call; all keys assumed same Apify workspace.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './_lib/auth.js'

const APIFY_BASE = 'https://api.apify.com/v2'

const ALLOWED_ACTORS = new Set([
  'apify~instagram-profile-scraper',
  'apify~instagram-hashtag-scraper',
  'apify~instagram-scraper',
  'apify~instagram-reel-scraper',
])

function getApifyKeys(): string[] {
  return [
    ...Array.from({ length: 10 }, (_, i) => process.env[`APIFY_KEY_${i + 1}`] ?? ''),
    ...String(process.env.APIFY_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
}

function pickKey(keys: string[]): string {
  return keys[Math.floor(Math.random() * keys.length)]
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await requireClerkUser(req, res)
  if (!user) return

  const keys = getApifyKeys()
  if (keys.length === 0) {
    res.status(500).json({ error: 'Server not configured: no Apify key' })
    return
  }

  let body: Record<string, unknown>
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>
  } catch {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  const operation = String(body.operation ?? '')
  const apiKey = pickKey(keys)

  if (operation === 'start') {
    const actorId = String(body.actorId ?? '')
    if (!ALLOWED_ACTORS.has(actorId)) {
      res.status(400).json({ error: 'Actor not allowed' })
      return
    }
    const upstream = await fetch(`${APIFY_BASE}/acts/${actorId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body.input ?? {}),
    })
    const text = await upstream.text()
    res.status(upstream.status).setHeader('Content-Type', 'application/json').end(text)
    return
  }

  if (operation === 'poll') {
    const runId = String(body.runId ?? '')
    if (!runId) { res.status(400).json({ error: 'runId required' }); return }
    const upstream = await fetch(`${APIFY_BASE}/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const text = await upstream.text()
    res.status(upstream.status).setHeader('Content-Type', 'application/json').end(text)
    return
  }

  if (operation === 'fetch') {
    const datasetId = String(body.datasetId ?? '')
    if (!datasetId) { res.status(400).json({ error: 'datasetId required' }); return }
    const upstream = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?clean=true`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const text = await upstream.text()
    res.status(upstream.status).setHeader('Content-Type', 'application/json').end(text)
    return
  }

  if (operation === 'abort') {
    // Best-effort: abort an orphaned server-side run so it stops consuming Apify credits.
    // The client fires this on abort/timeout — failures are silently swallowed (fire-and-forget).
    const runId = String(body.runId ?? '')
    if (!runId) { res.status(400).json({ error: 'runId required' }); return }
    const upstream = await fetch(`${APIFY_BASE}/actor-runs/${runId}/abort`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null)
    const status = upstream?.status ?? 200
    res.status(status >= 400 ? status : 200).json({ aborted: true })
    return
  }

  res.status(400).json({ error: 'Invalid operation' })
}
