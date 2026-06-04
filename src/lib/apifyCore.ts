/**
 * Shared Apify REST primitives — used by both apifyClient.ts and discoveryClient.ts.
 *
 * These three functions form the lifecycle of every Apify actor run:
 *   1. startRun  — POST /runs → returns runId + datasetId
 *   2. pollRun   — GET /actor-runs/{id} in a loop until SUCCEEDED or terminal error
 *   3. fetchDataset — GET /datasets/{id}/items → raw result array
 *
 * Extracted here so discoveryClient.ts can reuse them without importing from
 * apifyClient.ts (which would couple the two pipelines together).
 */

import pLimit from 'p-limit'
import { markKeyCooldown, pickAvailableKey } from './keyRotator'

export const BASE_URL = 'https://api.apify.com/v2'
export const POLL_INTERVAL_MS = 2000   // 2 seconds between polls
export const MAX_POLL_MS = 110_000     // 110s hard limit (leaves 10s buffer for 150s total timeout)

/**
 * Shared Apify run limiter for the REEL pipelines (reelScraper + reelVideoClient).
 *
 * pLimit(3): up to 3 concurrent Apify runs. keyRotator.pickAvailableKey is round-robin
 * (see its M10 note — built precisely for parallel scrapes), so 3 concurrent runs land
 * on 3 DISTINCT keys/accounts; with the user's up-to-10 keys no single account ever gets
 * more than one concurrent run. This ~3x's a multi-creator deep report vs serial while
 * staying within free-tier per-account limits. Competitor + discovery pipelines have
 * their own limiters and are unaffected by this value.
 */
export const apifyRunLimiter = pLimit(3)

// ----- Error class (shared between both clients) -----

export type ApifyErrorCode =
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'RUN_START_FAILED'
  | 'POLL_FAILED'
  | 'RUN_FAILED'
  | 'RUN_TIMEOUT'
  | 'RUN_ABORTED'
  | 'POLL_TIMEOUT'
  | 'DATASET_FETCH_FAILED'
  | 'ABORTED'

export class ApifyError extends Error {
  code: ApifyErrorCode
  status: number

  constructor(code: ApifyErrorCode, message: string, status: number) {
    super(message)
    this.name = 'ApifyError'
    this.code = code
    this.status = status
  }
}

/**
 * Pick a fresh Apify key for ONE actor run, throwing RATE_LIMITED if all are on cooldown.
 *
 * Call this once per RUN (the run's start→poll→fetch must share a key, but each run may use
 * a different account). The competitor + discovery clients call it per scrape so multi-round
 * analyses and parallel batches spread across the user's keys instead of hammering one — the
 * same per-run rotation the reel pipeline already uses (see reelScraper.scrapeTopReels).
 */
export function pickRunKey(apifyKeys: string[]): string {
  const apiKey = pickAvailableKey(apifyKeys)
  if (!apiKey) {
    throw new ApifyError(
      'RATE_LIMITED',
      'All Apify keys are on cooldown — please wait a few minutes and try again',
      429,
    )
  }
  return apiKey
}

// ----- Raw Apify response types -----

interface ApifyRunResponse {
  data: {
    id: string
    status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED'
    defaultDatasetId: string
  }
}

interface ApifyDatasetResponse<T> {
  items: T[]
}

// ----- Core API calls -----

/**
 * Start an actor run. Returns runId + datasetId for polling.
 */
export async function startRun(
  actorId: string,
  input: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ runId: string; datasetId: string }> {
  const url = `${BASE_URL}/acts/${actorId}/runs`
  // SECURITY (C3): never log the full request payload (scraped handles / target URLs)
  // in production — these logs live on the end-user's machine and in error captures.
  if (import.meta.env.DEV) console.debug('[apify] POST', url)

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'omit',   // required for Brave/strict browsers — no cookies sent cross-origin
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(input),
    signal,
  })

  if (!res.ok) {
    const body = await res.text()
    // SECURITY (C2): the raw Apify body can echo the request (actor IDs, the
    // handles/URLs we sent) and other internals. Keep it in the DEV console only —
    // never in the thrown message, which is surfaced to the chat UI.
    if (import.meta.env.DEV) console.error('[apify] startRun failed', res.status, body)
    if (res.status === 429) {
      markKeyCooldown(apiKey)
      throw new ApifyError('RATE_LIMITED', `Apify key rate limited. Marked for cooldown.`, res.status)
    }
    // 402 Payment Required = this key's Apify account is out of prepaid credit (free-tier $5 used
    // up, or a usage limit reached). Cool the key so the rotator routes around it, and surface
    // QUOTA_EXCEEDED so withKeyFailover rolls the run over to a key that still has budget. Without
    // this, a single tapped-out account failed the whole scrape even with 30 funded keys waiting.
    if (res.status === 402) {
      markKeyCooldown(apiKey)
      throw new ApifyError('QUOTA_EXCEEDED', `Apify account out of credit`, res.status)
    }
    // 403 with a usage/limit/feature-disabled body = this key's Apify account hit its monthly
    // hard limit. Cool the key down (like a rate-limit) so the rotator routes around it — a key
    // from another account has its own budget. Other 403s (genuine permission errors) fall through.
    if (res.status === 403 && /limit|usage|feature-disabled/i.test(body)) {
      markKeyCooldown(apiKey)
      throw new ApifyError('QUOTA_EXCEEDED', `Apify monthly usage limit exceeded`, res.status)
    }
    throw new ApifyError('RUN_START_FAILED', `Failed to start actor run (${res.status})`, res.status)
  }

  const json = (await res.json()) as ApifyRunResponse
  return { runId: json.data.id, datasetId: json.data.defaultDatasetId }
}

/**
 * Poll an actor run until it succeeds or fails. Returns the resolved datasetId.
 */
export async function pollRun(
  runId: string,
  apiKey: string,
  signal?: AbortSignal,
  maxPollMs?: number,
): Promise<string> {
  const deadline = Date.now() + (maxPollMs ?? MAX_POLL_MS)

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ApifyError('ABORTED', 'Request aborted', 0)

    let res: Response
    try {
      res = await fetch(`${BASE_URL}/actor-runs/${runId}`, {
        credentials: 'omit',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      })
    } catch (err) {
      // M3: an abort during the in-flight poll rejects with a DOMException(AbortError),
      // not an ApifyError — translate it so callers' `instanceof ApifyError` checks hold
      // and a timeout surfaces as the right message instead of "unexpected error".
      if (signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
        throw new ApifyError('ABORTED', 'Request aborted', 0)
      }
      throw err
    }

    if (!res.ok) throw new ApifyError('POLL_FAILED', `Poll failed: ${res.status}`, res.status)

    const json = (await res.json()) as ApifyRunResponse
    const { status } = json.data
    const datasetId = json.data.defaultDatasetId

    if (status === 'SUCCEEDED') return datasetId
    if (status === 'FAILED') throw new ApifyError('RUN_FAILED', 'Actor run failed', 0)
    if (status === 'TIMED-OUT') throw new ApifyError('RUN_TIMEOUT', 'Actor run timed out on Apify side', 0)
    if (status === 'ABORTED') throw new ApifyError('RUN_ABORTED', 'Actor run was aborted', 0)

    // Still READY or RUNNING — wait and poll again
    await sleep(POLL_INTERVAL_MS)
  }

  throw new ApifyError('POLL_TIMEOUT', `Run ${runId} did not complete within ${MAX_POLL_MS / 1000}s`, 0)
}

/**
 * Fetch all items from an Apify dataset.
 */
export async function fetchDataset<T>(datasetId: string, apiKey: string, signal?: AbortSignal): Promise<T[]> {
  const res = await fetch(`${BASE_URL}/datasets/${datasetId}/items?clean=true`, {
    credentials: 'omit',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  if (!res.ok) throw new ApifyError('DATASET_FETCH_FAILED', `Dataset fetch failed: ${res.status}`, res.status)
  const json = (await res.json()) as ApifyDatasetResponse<T>
  // Apify returns items directly as array for clean=true, or as { items: [] }
  return Array.isArray(json) ? json : (json.items ?? [])
}

/**
 * Run one Apify scrape with PER-RUN KEY FAILOVER.
 *
 * `run` performs ONE actor lifecycle (startRun → pollRun → fetchDataset) with the key it is
 * handed. withKeyFailover picks a fresh key per attempt and, if that key is out of budget or
 * rate-limited (QUOTA_EXCEEDED / RATE_LIMITED — both cool the key down in startRun), retries
 * with the NEXT available key, up to one attempt per key. THIS is what makes a pool of N keys
 * actually resilient: one tapped-out account ($5 free credit gone → 402) no longer fails the
 * whole scrape — the run rolls over to a key that still has credit. Any other error (abort, run
 * failure, genuine permission error) is not per-key, so it is rethrown immediately.
 *
 * Callback-based on purpose: the caller keeps the (independently mockable) startRun/pollRun/
 * fetchDataset calls inside `run`, so this composes with the existing per-client tests.
 */
export async function withKeyFailover<T>(
  apifyKeys: string[],
  run: (apiKey: string) => Promise<T>,
): Promise<T> {
  const maxAttempts = Math.max(1, apifyKeys.filter((k) => k.trim()).length)
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = pickRunKey(apifyKeys) // throws RATE_LIMITED once every key is on cooldown
    try {
      return await run(apiKey)
    } catch (err) {
      lastErr = err
      // Fail over to a fresh key only for per-key budget/rate errors. The dead key was already
      // cooled in startRun, so the next pickRunKey skips it. Everything else is not key-specific.
      if (err instanceof ApifyError && (err.code === 'QUOTA_EXCEEDED' || err.code === 'RATE_LIMITED')) {
        continue
      }
      throw err
    }
  }
  // Every key was tried and each was out of budget / rate-limited.
  throw lastErr ?? new ApifyError('RATE_LIMITED', 'All Apify keys are exhausted or on cooldown', 429)
}

// ----- Utilities -----

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
