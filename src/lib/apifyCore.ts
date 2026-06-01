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

import { markKeyCooldown } from './keyRotator'

export const BASE_URL = 'https://api.apify.com/v2'
export const POLL_INTERVAL_MS = 2000   // 2 seconds between polls
export const MAX_POLL_MS = 110_000     // 110s hard limit (leaves 10s buffer for 150s total timeout)

// ----- Error class (shared between both clients) -----

export type ApifyErrorCode =
  | 'RATE_LIMITED'
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
  console.debug('[apify] POST', url, input)

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
    if (res.status === 429) {
      markKeyCooldown(apiKey)
      throw new ApifyError('RATE_LIMITED', `Apify key rate limited. Marked for cooldown.`, res.status)
    }
    throw new ApifyError('RUN_START_FAILED', `Failed to start actor run: ${res.status} ${body}`, res.status)
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
  let datasetId = ''

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ApifyError('ABORTED', 'Request aborted', 0)

    const res = await fetch(`${BASE_URL}/actor-runs/${runId}`, {
      credentials: 'omit',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })

    if (!res.ok) throw new ApifyError('POLL_FAILED', `Poll failed: ${res.status}`, res.status)

    const json = (await res.json()) as ApifyRunResponse
    const { status } = json.data
    datasetId = json.data.defaultDatasetId

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
