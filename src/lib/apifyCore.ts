/**
 * Shared Apify REST primitives — routes all calls through the /api/apify server proxy.
 *
 * After Phase 1: API keys live on the server (never exposed in the browser bundle).
 * The three lifecycle functions (startRun, pollRun, fetchDataset) post to /api/apify
 * with a Clerk Bearer token. The proxy forwards to Apify with server-held credentials.
 *
 * The apiKey parameter is kept in all three function signatures for call-site
 * compatibility but is ignored — the proxy selects a key from process.env.
 */

import pLimit from 'p-limit'
import { getClerkSessionToken } from './clerkToken'

export const BASE_URL = '/api/apify'
// 6.7: exponential poll backoff — start at 2s, multiply by 1.5 each poll, cap at 8s.
export const POLL_INTERVAL_INIT_MS = 2000
export const POLL_INTERVAL_MAX_MS  = 8000
export const POLL_INTERVAL_FACTOR  = 1.5
export const MAX_POLL_MS = 110_000     // 110s hard limit (leaves 10s buffer for 150s total timeout)
// Back-compat export so existing test imports that reference POLL_INTERVAL_MS don't break.
export const POLL_INTERVAL_MS = POLL_INTERVAL_INIT_MS

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
 * After Phase 1: the proxy handles key selection server-side.
 * Returns an empty string (ignored by the proxy transport). Kept for call-site compat.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function pickRunKey(_apifyKeys: string[]): string {
  return ''
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
 * Start an actor run via the /api/apify proxy. Returns runId + datasetId for polling.
 * The _apiKey parameter is kept for call-site compatibility but ignored — the proxy
 * selects a key from server env.
 */
export async function startRun(
  actorId: string,
  input: Record<string, unknown>,
  _apiKey: string,
  signal?: AbortSignal,
): Promise<{ runId: string; datasetId: string }> {
  if (import.meta.env.DEV) console.debug('[apify] proxy start', actorId)
  const clerkToken = await getClerkSessionToken()
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {}),
    },
    body: JSON.stringify({ operation: 'start', actorId, input }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text()
    if (import.meta.env.DEV) console.error('[apify] startRun failed', res.status, body)
    if (res.status === 429) throw new ApifyError('RATE_LIMITED', 'Apify rate limited — all server keys exhausted.', res.status)
    if (res.status === 402) throw new ApifyError('QUOTA_EXCEEDED', 'Apify account out of credit', res.status)
    if (res.status === 403 && /limit|usage|feature-disabled/i.test(body)) throw new ApifyError('QUOTA_EXCEEDED', 'Apify monthly usage limit exceeded', res.status)
    throw new ApifyError('RUN_START_FAILED', `Failed to start actor run (${res.status})`, res.status)
  }

  const json = (await res.json()) as ApifyRunResponse
  return { runId: json.data.id, datasetId: json.data.defaultDatasetId }
}

// Max consecutive transient errors (429/5xx) before giving up on a poll (2.14).
const MAX_TRANSIENT_FAILURES = 4
// 2.14: only 429 and 5xx are transient; all other non-ok statuses (4xx including 404)
// are hard failures that should surface immediately.
const isPollTransient = (status: number) => status === 429 || status >= 500

/**
 * Poll an actor run via the /api/apify proxy until it succeeds or fails.
 * Returns the resolved datasetId.
 * The _apiKey parameter is kept for call-site compatibility but ignored.
 *
 * Phase 2.12: on abort/timeout, fires best-effort abort of the server-side Apify run
 * so it doesn't keep consuming Apify credits after the client has moved on.
 *
 * Phase 2.14: tolerates up to MAX_TRANSIENT_FAILURES consecutive 429/5xx responses
 * within the deadline — a single network blip no longer kills a 2-minute scrape.
 */
export async function pollRun(
  runId: string,
  _apiKey: string,
  signal?: AbortSignal,
  maxPollMs?: number,
): Promise<string> {
  const deadline = Date.now() + (maxPollMs ?? MAX_POLL_MS)
  const clerkToken = await getClerkSessionToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (clerkToken) headers['Authorization'] = `Bearer ${clerkToken}`

  const abortApifyRun = () => {
    // Fire-and-forget: abort the Apify actor run so it stops consuming credits.
    // Use optional chaining on .catch so test mocks that return undefined don't crash.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (fetch(BASE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ operation: 'abort', runId }),
    }) as Promise<unknown> | undefined)?.catch?.(() => {})
  }

  // Pre-loop guard: if the signal is already aborted before we start, bail immediately
  // without touching Apify (the caller handles cleanup for pre-start aborts).
  if (signal?.aborted) throw new ApifyError('ABORTED', 'Request aborted', 0)

  let transientFailures = 0
  let pollInterval = POLL_INTERVAL_INIT_MS

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      // Mid-poll abort: signal fired during an ongoing scrape — tell Apify to stop.
      abortApifyRun()
      throw new ApifyError('ABORTED', 'Request aborted', 0)
    }

    let res: Response
    try {
      res = await fetch(BASE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ operation: 'poll', runId }),
        signal,
      })
    } catch (err) {
      // M3: an abort during the in-flight poll rejects with a DOMException(AbortError),
      // not an ApifyError — translate it so callers' `instanceof ApifyError` checks hold
      // and a timeout surfaces as the right message instead of "unexpected error".
      if (signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
        abortApifyRun()
        throw new ApifyError('ABORTED', 'Request aborted', 0)
      }
      throw err
    }

    if (!res.ok) {
      // 2.14: retry only truly transient failures (429 rate-limit, 5xx server error);
      // hard-fail on everything else (4xx including 404 = bad request / not-found).
      if (isPollTransient(res.status) && transientFailures < MAX_TRANSIENT_FAILURES) {
        transientFailures++
        await sleep(POLL_INTERVAL_MS * (transientFailures + 1)) // progressive backoff
        continue
      }
      throw new ApifyError('POLL_FAILED', `Poll failed: ${res.status}`, res.status)
    }

    transientFailures = 0 // reset on a successful response
    const json = (await res.json()) as ApifyRunResponse
    const { status } = json.data
    const datasetId = json.data.defaultDatasetId

    if (status === 'SUCCEEDED') return datasetId
    if (status === 'FAILED') throw new ApifyError('RUN_FAILED', 'Actor run failed', 0)
    if (status === 'TIMED-OUT') throw new ApifyError('RUN_TIMEOUT', 'Actor run timed out on Apify side', 0)
    if (status === 'ABORTED') throw new ApifyError('RUN_ABORTED', 'Actor run was aborted', 0)

    // Still READY or RUNNING — back-off wait then poll again.
    await sleep(pollInterval)
    pollInterval = Math.min(Math.round(pollInterval * POLL_INTERVAL_FACTOR), POLL_INTERVAL_MAX_MS)
  }

  abortApifyRun()
  throw new ApifyError('POLL_TIMEOUT', `Run ${runId} did not complete within ${(maxPollMs ?? MAX_POLL_MS) / 1000}s`, 0)
}

/**
 * Fetch all items from an Apify dataset via the /api/apify proxy.
 * The _apiKey parameter is kept for call-site compatibility but ignored.
 */
export async function fetchDataset<T>(datasetId: string, _apiKey: string, signal?: AbortSignal): Promise<T[]> {
  const clerkToken = await getClerkSessionToken()
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {}),
    },
    body: JSON.stringify({ operation: 'fetch', datasetId }),
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
