/**
 * Reel scraper — fetches the top N reels by views for an Instagram handle.
 *
 * Uses apify~instagram-scraper with resultsLimit: 120 (recent posts),
 * filters to clips (productType === 'clips') — NO view-count gate. Small/new reels
 * legitimately report 0 or missing views, and the actor sometimes reports views under
 * playCount/viewCount rather than videoViewCount; gating on videoViewCount > 0 produced
 * false "no reels" on public accounts that have reels. Views are coalesced and used only
 * to sort; sorts by views descending, returns top Math.min(n, reels.length).
 *
 * Throws NoReelsError if zero reels pass the filter.
 * Throws ApifyError on Apify failures (including RATE_LIMITED when all keys are on cooldown).
 * Serialized via global pLimit(1) — one Apify run at a time (free-tier concurrency protection).
 */

import { startRun, pollRun, fetchDataset, apifyRunLimiter, withKeyFailover } from './apifyCore'
import { ACTORS, buildReelScraperInput } from './actors'
import type { ReelData } from '../store/reelAnalysisStore'

// Shared Apify limiter (pLimit(3), key-rotated across distinct accounts) from apifyCore,
// so this list scrape + the reel-video scrape queue on the SAME gate. See apifyCore.
const apifyLimiter = apifyRunLimiter

// ----- Error class -----

/**
 * NoReelsError: thrown when scrape succeeds but zero reels pass the filter.
 * Distinct from ApifyError so callers can set status='no-reels' vs 'failed'.
 */
export class NoReelsError extends Error {
  constructor(handle: string) {
    super(`@${handle} has no recent Reels — account may post photos only`)
    this.name = 'NoReelsError'
  }
}

// ----- Raw post type from apify~instagram-scraper -----

interface RawPost {
  shortCode?: string
  url?: string
  displayUrl?: string
  videoViewCount?: number
  playCount?: number // apify~instagram-scraper sometimes reports reel views here, not videoViewCount
  viewCount?: number // ...or here. Coalesced in toReelData (mirrors trackingClient.ts).
  likesCount?: number
  commentsCount?: number
  videoDuration?: number
  caption?: string | null
  hashtags?: string[]
  musicInfo?: unknown
  productType?: string // 'clips' for reels, other values for photos/carousels
}

// ----- Mapping helper -----

function toReelData(raw: RawPost): ReelData {
  return {
    shortCode: raw.shortCode ?? '',
    url: raw.url ?? '',
    displayUrl: raw.displayUrl ?? '',
    videoViewCount: raw.videoViewCount ?? raw.playCount ?? raw.viewCount ?? 0,
    likesCount: raw.likesCount ?? 0,
    commentsCount: raw.commentsCount ?? 0,
    videoDuration: raw.videoDuration ?? 0,
    caption: raw.caption ?? '',
    hashtags: raw.hashtags ?? [],
    musicInfo: raw.musicInfo,
  }
}

// ----- Pure filter/sort helper (exported for unit testing) -----

/**
 * Filter, sort, and slice raw Apify posts into ReelData[].
 *
 * Filters to productType === 'clips' (a reel). Does NOT require views > 0 — small/new reels
 * often report 0 or missing views, and dropping them produced false "no reels" on public
 * accounts that genuinely have reels. View count is coalesced (videoViewCount ?? playCount ??
 * viewCount) in toReelData and used only to sort; 0-view reels are kept (sorted last).
 *
 * Returns [] only when no clips are present at all (caller decides whether to throw).
 */
export function filterAndSortReels(rawPosts: unknown[], n: number): ReelData[] {
  const posts = rawPosts as RawPost[]
  const allReels = posts
    .filter((p) => p.productType === 'clips')
    .map(toReelData)
    .sort((a, b) => b.videoViewCount - a.videoViewCount)
  return allReels.slice(0, Math.min(n, allReels.length))
}

// ----- Main export -----

/**
 * Scrape the top N reels by views for an Instagram handle.
 *
 * @param handle     Instagram handle (with or without @)
 * @param n          Number of top reels to return
 * @param apifyKeys  Array of Apify API keys from keysStore
 * @param signal     Optional AbortSignal for cancellation
 */
export async function scrapeTopReels(
  handle: string,
  n: number,
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<ReelData[]> {
  return apifyLimiter(async () => {
    // Build actor input: fetch up to 120 recent posts (fewer if the account has fewer),
    // filter to reels client-side
    const input = buildReelScraperInput(handle, 120)

    // One actor lifecycle, with per-run key failover: if the chosen account is out of credit
    // (402) or rate-limited, the run rolls over to the next funded key instead of failing.
    const rawPosts = await withKeyFailover(apifyKeys, async (apiKey) => {
      const { runId, datasetId, keyIndex } = await startRun(ACTORS.REEL_SCRAPER, input, apiKey, signal)
      // Poll until SUCCEEDED — 5 min idle budget (10 min hard ceiling) for
      // apify~instagram-scraper cold starts + the larger 120-post scrape.
      await pollRun(runId, apiKey, signal, 300_000, keyIndex)
      return fetchDataset<RawPost>(datasetId, apiKey, signal, keyIndex)
    })

    // Filter to reels only, map to ReelData, sort by views desc, take top n
    const reels = filterAndSortReels(rawPosts, n)

    if (reels.length === 0) {
      throw new NoReelsError(handle)
    }

    return reels
  })
}
