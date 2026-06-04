/**
 * Reel scraper — fetches the top N reels by views for an Instagram handle.
 *
 * Uses apify~instagram-scraper with resultsLimit: 30 (recent posts),
 * filters to clips (productType === 'clips' AND videoViewCount > 0),
 * sorts by videoViewCount descending, returns top Math.min(n, reels.length).
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
    videoViewCount: raw.videoViewCount ?? 0,
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
 * Filters to productType === 'clips' AND videoViewCount > 0,
 * sorts by videoViewCount descending, returns top Math.min(n, results.length).
 *
 * Returns [] when no posts pass the filter (caller decides whether to throw).
 */
export function filterAndSortReels(rawPosts: unknown[], n: number): ReelData[] {
  const posts = rawPosts as RawPost[]
  const allReels = posts
    .filter((p) => p.productType === 'clips' && (p.videoViewCount ?? 0) > 0)
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
    // Build actor input: fetch 30 recent posts, filter to reels client-side
    const input = buildReelScraperInput(handle, 30)

    // One actor lifecycle, with per-run key failover: if the chosen account is out of credit
    // (402) or rate-limited, the run rolls over to the next funded key instead of failing.
    const rawPosts = await withKeyFailover(apifyKeys, async (apiKey) => {
      const { runId, datasetId } = await startRun(ACTORS.REEL_SCRAPER, input, apiKey, signal)
      // Poll until SUCCEEDED — 3 min timeout for apify~instagram-scraper cold starts
      await pollRun(runId, apiKey, signal, 180_000)
      return fetchDataset<RawPost>(datasetId, apiKey, signal)
    })

    // Filter to reels only, map to ReelData, sort by views desc, take top n
    const reels = filterAndSortReels(rawPosts, n)

    if (reels.length === 0) {
      throw new NoReelsError(handle)
    }

    return reels
  })
}
