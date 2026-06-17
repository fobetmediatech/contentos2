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
 *
 * Key affinity: the pool is N SEPARATE Apify accounts (not one workspace), so a run is
 * owned by the account whose key started it. `start` reports its key index via the
 * `x-apify-key-index` response header; the client echoes it back as `keyIndex` on
 * poll/fetch/abort so the SAME account's key is reused (a different key 403s the run).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setGlobalDispatcher, Agent } from 'undici'
import { requireClerkUser } from './_lib/auth.js'

// Node's default autoSelectFamily ("Happy Eyeballs") connect logic stalls ~6s reaching
// Apify's dual-A-record AWS host from some networks, intermittently exceeding undici's
// default 10s connect timeout (UND_ERR_CONNECT_TIMEOUT). Disabling it makes the connect
// pick a working IP directly (~0.3-1.2s), and widening the connect timeout to 30s lets a
// slow connect finish instead of aborting. Harmless on Vercel (fast path, Apify is IPv4-only).
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000, autoSelectFamily: false } }))

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

// Statuses worth retrying on a DIFFERENT key: 429 (rate limited) and 402 (account
// out of credit). Other statuses (incl. 4xx for a bad run/dataset) are the caller's
// problem, not the key's, so we pass them straight back.
const RETRYABLE = new Set([429, 402])

/**
 * Run an upstream Apify request with key failover, used by `start` (and as a legacy
 * fallback for poll/fetch): shuffle the pool and, on a 429/402, roll to the next key
 * before giving up. Returns which pool slot served the request so the caller can pin the
 * run's later poll/fetch/abort to that same account (a different account 403s the run).
 * Without failover, a single rate-limited or credit-exhausted key would fail the whole
 * pipeline even though other funded keys are available.
 */
async function fetchWithFailover(
  keys: string[],
  build: (apiKey: string) => { url: string; init?: RequestInit },
): Promise<{ res: Response; index: number }> {
  // Shuffle INDICES (not the keys) so we can report the original pool slot that served it.
  // Math.random() is fine here — load-balancing, not cryptography.
  const order = keys.map((_, i) => i).sort(() => Math.random() - 0.5)
  for (let n = 0; n < order.length; n++) {
    const index = order[n]
    const { url, init } = build(keys[index])
    const res = await fetch(url, init)
    if (RETRYABLE.has(res.status) && n < order.length - 1) {
      await res.body?.cancel()
      continue
    }
    return { res, index }
  }
  // Unreachable: the final iteration always returns. Satisfies the type checker.
  throw new Error('fetchWithFailover: empty key pool')
}

/**
 * Resolve the key a follow-up request (poll/fetch/abort) MUST reuse. An Apify run is owned
 * by the account whose key started it, so polling/fetching/aborting with a different
 * account's key returns 403. The client echoes back the `keyIndex` that `start` reported;
 * we reuse exactly that pool slot. Returns null when no valid index is supplied (legacy
 * callers / runs started before this shipped) — the caller then falls back to failover.
 */
function pinnedKey(keys: string[], body: Record<string, unknown>): string | null {
  const ki = body.keyIndex
  return typeof ki === 'number' && Number.isInteger(ki) && ki >= 0 && ki < keys.length ? keys[ki] : null
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

  if (operation === 'start') {
    const actorId = String(body.actorId ?? '')
    if (!ALLOWED_ACTORS.has(actorId)) {
      res.status(400).json({ error: 'Actor not allowed' })
      return
    }
    const { res: upstream, index } = await fetchWithFailover(keys, (apiKey) => ({
      url: `${APIFY_BASE}/acts/${actorId}/runs`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body.input ?? {}),
      },
    }))
    const text = await upstream.text()
    res
      .status(upstream.status)
      .setHeader('Content-Type', 'application/json')
      .setHeader('x-apify-key-index', String(index)) // client pins poll/fetch/abort to this account
      .end(text)
    return
  }

  if (operation === 'poll') {
    const runId = String(body.runId ?? '')
    if (!runId) { res.status(400).json({ error: 'runId required' }); return }
    // Reuse the account that started the run (failing over to another account would 403).
    // No pin (legacy caller / pre-deploy run) → fall back to failover.
    const pinned = pinnedKey(keys, body)
    const upstream = pinned
      ? await fetch(`${APIFY_BASE}/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${pinned}` } })
      : (await fetchWithFailover(keys, (apiKey) => ({
          url: `${APIFY_BASE}/actor-runs/${runId}`,
          init: { headers: { Authorization: `Bearer ${apiKey}` } },
        }))).res
    const text = await upstream.text()
    res.status(upstream.status).setHeader('Content-Type', 'application/json').end(text)
    return
  }

  if (operation === 'fetch') {
    const datasetId = String(body.datasetId ?? '')
    if (!datasetId) { res.status(400).json({ error: 'datasetId required' }); return }
    // The dataset belongs to the run's account — reuse the pinned key (else failover).
    const pinned = pinnedKey(keys, body)
    const upstream = pinned
      ? await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?clean=true`, { headers: { Authorization: `Bearer ${pinned}` } })
      : (await fetchWithFailover(keys, (apiKey) => ({
          url: `${APIFY_BASE}/datasets/${datasetId}/items?clean=true`,
          init: { headers: { Authorization: `Bearer ${apiKey}` } },
        }))).res
    const text = await upstream.text()
    res.status(upstream.status).setHeader('Content-Type', 'application/json').end(text)
    return
  }

  if (operation === 'abort') {
    // Best-effort: abort an orphaned server-side run so it stops consuming Apify credits.
    // The client fires this on abort/timeout — failures are silently swallowed (fire-and-forget).
    // Must use the OWNING account's key (pinned) — a different account can't abort the run.
    const runId = String(body.runId ?? '')
    if (!runId) { res.status(400).json({ error: 'runId required' }); return }
    const apiKey = pinnedKey(keys, body) ?? pickKey(keys)
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
