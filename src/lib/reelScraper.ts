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

import pLimit from 'p-limit'
import { startRun, pollRun, fetchDataset, ApifyError } from './apifyCore'
import { pickAvailableKey } from './keyRotator'
import { ACTORS, buildReelScraperInput } from './actors'
import type { ReelData } from '../store/reelAnalysisStore'

// Global p-limit(1): serializes ALL Apify runs — free-tier concurrency protection
const apifyLimiter = pLimit(1)

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
    // Pick an available key — throw RATE_LIMITED if all are on cooldown
    const apiKey = pickAvailableKey(apifyKeys)
    if (!apiKey) {
      throw new ApifyError(
        'RATE_LIMITED',
        'All Apify keys are on cooldown — please wait a few minutes and try again',
        429,
      )
    }

    // Build actor input: fetch 30 recent posts, filter to reels client-side
    const input = buildReelScraperInput(handle, 30)

    // Start the actor run
    const { runId, datasetId } = await startRun(ACTORS.REEL_SCRAPER, input, apiKey)

    // Poll until SUCCEEDED — 3 min timeout for apify~instagram-scraper cold starts
    await pollRun(runId, apiKey, signal, 180_000)

    // Fetch the raw dataset
    const rawPosts = await fetchDataset<RawPost>(datasetId, apiKey)

    // Filter to reels only, map to ReelData, sort by views desc, take top n
    const allReels = rawPosts
      .filter((p) => p.productType === 'clips' && (p.videoViewCount ?? 0) > 0)
      .map(toReelData)
      .sort((a, b) => b.videoViewCount - a.videoViewCount)

    const reels = allReels.slice(0, Math.min(n, allReels.length))

    if (reels.length === 0) {
      throw new NoReelsError(handle)
    }

    return reels
  })
}
