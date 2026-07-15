/**
 * Apify run-sync helper for server-side background jobs (the voice warmer). Node port of
 * tracking-cron's Deno apifyRunSync: run-sync-get-dataset-items with a round-robin key ring
 * + failover on auth/quota/transient statuses. Self-contained (no browser keyRotator).
 */
const APIFY_BASE = 'https://api.apify.com/v2'
const ACTOR_TIMEOUT_MS = 90_000
const ROTATE_STATUSES = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504])

/** APIFY_KEY_1..10 (numbered) + APIFY_KEYS (comma-separated), trimmed, non-empty. */
export function getApifyKeys(): string[] {
  return [
    ...Array.from({ length: 10 }, (_, i) => process.env[`APIFY_KEY_${i + 1}`] ?? ''),
    ...String(process.env.APIFY_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
}

export interface KeyRing { keys: string[]; i: number }

/** Run an Apify actor synchronously, rotating the key ring with failover. Throws on hard failure. */
export async function apifyRunSync<T>(
  actorId: string,
  input: Record<string, unknown>,
  ring: KeyRing,
): Promise<T[]> {
  let lastErr = 'no keys configured'
  for (let attempt = 0; attempt < ring.keys.length; attempt++) {
    const token = ring.keys[ring.i % ring.keys.length]
    ring.i++
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ACTOR_TIMEOUT_MS)
    let permanent: string | null = null
    try {
      const res = await fetch(
        `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${token}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: ctrl.signal },
      )
      if (res.ok) {
        const data = (await res.json()) as unknown
        if (Array.isArray(data)) return data as T[]
        const errMsg = (data as { error?: { message?: string } } | null)?.error?.message
        lastErr = errMsg || 'non-array response'
      } else if (ROTATE_STATUSES.has(res.status)) {
        lastErr = `HTTP ${res.status}`
      } else {
        permanent = `HTTP ${res.status} ${res.statusText}`
      }
    } catch (e) {
      lastErr = e instanceof Error ? (e.name === 'AbortError' ? `timeout after ${ACTOR_TIMEOUT_MS}ms` : e.message) : String(e)
    } finally {
      clearTimeout(timer)
    }
    if (permanent) throw new Error(`Apify ${actorId} failed: ${permanent}`)
  }
  throw new Error(`Apify ${actorId}: all ${ring.keys.length} key(s) failed (${lastErr})`)
}
