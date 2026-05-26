/**
 * Apify REST API client — async run management with polling.
 *
 * Apify actor runs are ASYNC. POST /runs starts the run and returns a runId.
 * You must then poll GET /runs/{runId} until status === 'SUCCEEDED',
 * then fetch the dataset. This file handles the full lifecycle.
 *
 * Discovery pipeline (3 rounds + parallel hashtag expansion):
 *   Round 1:   Scrape input handles → extract relatedHandles + topHashtags
 *   Round 2:   Scrape relatedHandles → full competitor profiles
 *   Hashtag:   Scrape topHashtags (runs in PARALLEL with Round 2) → post authors
 *              → profile scrape those authors → content-niche candidates
 *   Round 3:   Scrape relatedHandles of Round 2 candidates → expand pool further
 *
 * The hashtag expansion is the key fix for pool contamination:
 *   - relatedProfiles is audience-adjacency (who watches the same content)
 *   - Hashtag posts are content-niche (who posts about the same topics)
 * Both signals are combined into the candidate pool before Gemini analysis.
 */

import pLimit from 'p-limit'
import { ACTORS, buildProfileScraperInput, buildHashtagScraperInput } from './actors'
import { normalizeProfiles, type ApifyProfileRaw, type NormalizedProfile } from './transformers'
import { markKeyCooldown } from './keyRotator'

const BASE_URL = 'https://api.apify.com/v2'
const POLL_INTERVAL_MS = 2000   // 2 seconds between polls
const MAX_POLL_MS = 110_000     // 110s hard limit (leaves 10s buffer for 120s total timeout)
const MAX_CONCURRENT = 3        // p-limit cap for concurrent actor runs

// Concurrency limiter — prevents firing too many actor runs simultaneously
const limit = pLimit(MAX_CONCURRENT)

// ----- Types -----

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

async function startRun(
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

async function pollRun(
  runId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const deadline = Date.now() + MAX_POLL_MS
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

async function fetchDataset<T>(datasetId: string, apiKey: string, signal?: AbortSignal): Promise<T[]> {
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

// ----- Types -----

/** Raw post item from the Hashtag Scraper dataset */
interface HashtagPostRaw {
  ownerUsername?: string
  ownerId?: string
  productType?: string
}

// ----- High-level: scrape profiles -----

/**
 * Scrape a batch of Instagram handles and return normalized profiles.
 * Handles the full lifecycle: start → poll → fetch → normalize.
 */
async function scrapeHandles(
  handles: string[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<NormalizedProfile[]> {
  const input = buildProfileScraperInput(handles)
  const { runId, datasetId } = await startRun(ACTORS.PROFILE_SCRAPER, input, apiKey, signal)
  const resolvedDatasetId = await pollRun(runId, apiKey, signal)
  const raw = await fetchDataset<ApifyProfileRaw>(resolvedDatasetId || datasetId, apiKey, signal)
  return normalizeProfiles(raw)
}

/**
 * Scrape recent posts for each hashtag and return unique usernames of post authors.
 *
 * This is the content-niche signal path:
 *   hashtags → posts → ownerUsername → unique handles
 *
 * Returns usernames only — caller is responsible for filtering against seenHandles
 * and then running a profile scrape batch on the resulting handles.
 *
 * @param hashtags     Top hashtags from reference profiles (plain strings, no #)
 * @param apiKey       Active Apify API key
 * @param signal       AbortController signal
 * @param perHashtag   Max posts to fetch per hashtag (default: 20)
 */
async function scrapeHashtagUsernames(
  hashtags: string[],
  apiKey: string,
  signal?: AbortSignal,
  perHashtag = 20,
): Promise<string[]> {
  if (hashtags.length === 0) return []

  const top3 = hashtags.slice(0, 3)
  const input = buildHashtagScraperInput(top3, perHashtag)
  const { runId, datasetId } = await startRun(ACTORS.HASHTAG_SCRAPER, input, apiKey, signal)
  const resolvedDatasetId = await pollRun(runId, apiKey, signal)
  const posts = await fetchDataset<HashtagPostRaw>(resolvedDatasetId || datasetId, apiKey, signal)

  // Extract ownerUsername from each post, drop missing/empty values
  const usernames = posts
    .map((p) => p.ownerUsername?.trim().toLowerCase())
    .filter((u): u is string => Boolean(u))

  // Deduplicate
  return [...new Set(usernames)]
}

// ----- Public API: 2-round competitor discovery -----

export interface ScrapeResult {
  inputProfiles: NormalizedProfile[]
  candidateProfiles: NormalizedProfile[]
}

// Round 3 pool-expansion caps. Standard always runs Round 3 now — the depth gate
// was removed because the timing fits comfortably within the 120s budget even on
// standard runs (~15s Round 1 + ~25s Round 2 + ~15s Round 3 + ~8s Gemini ≈ 63s).
// Increasing the cap is how you get more candidates; standard=10 targets ≥15 total
// candidates so Gemini has enough pool to return a full 10 competitors after filtering.
const ROUND3_CAP: Record<'standard' | 'deep', number> = {
  standard: 10,
  deep: 20,
}

/**
 * Full discovery pipeline: Round 1 → Round 2 + Hashtag (parallel) → Round 3.
 *
 * Round 1: Scrape input handles → profiles + relatedHandles + topHashtags
 * Round 2: Scrape relatedHandles (audience-adjacency signal)     ┐ parallel
 * Hashtag: Scrape post authors from topHashtags (content-niche)  ┘
 *          → profile scrape those authors → content-niche candidates
 * Round 3: Scrape relatedHandles of Round 2 candidates → expand pool
 *          Always runs. Cap = 10 (standard) or 20 (deep).
 *
 * The parallel hashtag expansion fixes pool contamination:
 *   relatedProfiles = who watches same content (audience-adjacency)
 *   Hashtag posts  = who posts about same topics (content-niche)
 * Combining both signals gives Gemini a better, more niche-relevant pool.
 *
 * @param inputHandles  1–5 reference Instagram handles
 * @param apiKey        Active Apify API key (pre-selected by keyRotator)
 * @param signal        AbortController signal for 120s timeout
 * @param depth         Controls Round 3 cap: 'standard' = 10, 'deep' = 20
 */
export async function discoverCompetitors(
  inputHandles: string[],
  apiKey: string,
  signal?: AbortSignal,
  depth: 'standard' | 'deep' = 'standard',
): Promise<ScrapeResult> {
  // Round 1: scrape input handles → get profiles, relatedHandles, topHashtags
  const inputProfiles = await scrapeHandles(inputHandles, apiKey, signal)

  // Build seen set to avoid re-scraping any handle
  const seenHandles = new Set(inputHandles.map((h) => h.replace(/^@/, '').toLowerCase()))

  // Extract candidate handles from Round 1 relatedProfiles
  const allRelated = inputProfiles.flatMap((p) => p.relatedHandles)
  const candidateHandles = [...new Set(allRelated)]
    .filter((h) => !seenHandles.has(h.toLowerCase()))

  if (candidateHandles.length === 0) {
    return { inputProfiles, candidateProfiles: [] }
  }

  // Extract top hashtags from input profiles for content-niche expansion
  const allHashtags = inputProfiles.flatMap((p) => p.topHashtags)
  const uniqueHashtags = [...new Set(allHashtags)]

  // Round 2 + Hashtag expansion: run in PARALLEL
  // Round 2 uses audience-adjacency signal (relatedProfiles)
  // Hashtag uses content-niche signal (who actually posts about these topics)
  const round2Batches = chunk(candidateHandles, 10)
  const [round2Results, hashtagUsernames] = await Promise.all([
    // Round 2: scrape relatedProfile candidates
    Promise.all(
      round2Batches.map((batch) => limit(() => scrapeHandles(batch, apiKey, signal))),
    ),
    // Hashtag expansion: post authors from top-3 hashtags (guard: empty → [])
    uniqueHashtags.length > 0
      ? scrapeHashtagUsernames(uniqueHashtags, apiKey, signal)
      : Promise.resolve([] as string[]),
  ])

  const round2Profiles = round2Results.flat()
  candidateHandles.forEach((h) => seenHandles.add(h.toLowerCase()))

  // Compute hashtag handles first (filtered against round1+round2 seen set).
  // Cap at 20 (2 batches) — beyond this the timing cost exceeds the pool quality gain.
  const hashtagHandles = hashtagUsernames
    .filter((h) => !seenHandles.has(h))
    .slice(0, 20)

  console.log(`[hashtag] ${hashtagHandles.length} net-new handles from content-niche expansion (${uniqueHashtags.slice(0, 3).join(', ')})`)

  // Add hashtag handles to seen BEFORE computing Round 3 — prevents overlap between
  // the two parallel scrapes, keeping the combined pool clean.
  hashtagHandles.forEach((h) => seenHandles.add(h))

  // Compute Round 3 handles (now filtered against round1+round2+hashtag seen set).
  const round3Cap = ROUND3_CAP[depth]
  const round3Related = round2Profiles.flatMap((p) => p.relatedHandles)
  const round3Handles = [...new Set(round3Related)]
    .filter((h) => !seenHandles.has(h.toLowerCase()))
    .slice(0, round3Cap)

  console.log(`[round3] ${round3Handles.length} net-new handles (cap: ${round3Cap}, seen: ${seenHandles.size})`)

  // Hashtag profile scrape + Round 3 run IN PARALLEL.
  // Both only need data already available (round2Profiles and hashtagHandles),
  // so there is no dependency between them. Sequential cost was ~50s; parallel = ~25s.
  const [hashtagProfiles, round3Profiles] = await Promise.all([
    // Hashtag path: profile-scrape the content-niche handles
    (async (): Promise<NormalizedProfile[]> => {
      if (hashtagHandles.length === 0) {
        console.log('[hashtag] 0 net-new handles from hashtag path (empty topHashtags or all seen)')
        return []
      }
      const batches = chunk(hashtagHandles, 10)
      const results = await Promise.all(batches.map((b) => limit(() => scrapeHandles(b, apiKey, signal))))
      const profiles = results.flat()
      console.log(`[hashtag] scraped ${profiles.length} profiles from content-niche path`)
      return profiles
    })(),
    // Round 3: expand pool from relatedHandles of Round 2 candidates
    (async (): Promise<NormalizedProfile[]> => {
      if (round3Handles.length === 0) {
        console.log('[round3] 0 net-new handles — relatedProfiles graph is closed for these reference accounts')
        return []
      }
      const batches = chunk(round3Handles, 10)
      const results = await Promise.all(batches.map((b) => limit(() => scrapeHandles(b, apiKey, signal))))
      const profiles = results.flat()
      console.log(`[round3] scraped ${profiles.length} profiles`)
      return profiles
    })(),
  ])

  const candidateProfiles = [...round2Profiles, ...hashtagProfiles, ...round3Profiles]
  console.log(`[pipeline] total candidates: ${candidateProfiles.length} (r2: ${round2Profiles.length}, hashtag: ${hashtagProfiles.length}, r3: ${round3Profiles.length})`)
  return { inputProfiles, candidateProfiles }
}

// ----- Error class -----

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

// ----- Utilities -----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
