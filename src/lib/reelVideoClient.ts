/**
 * Reel VIDEO client — resolves stable, server-fetchable video URLs for a set of reels.
 *
 * Phase-1 reel intelligence: after scrapeTopReels lists a creator's top reels (with
 * permalinks), this runs apify~instagram-reel-scraper ONCE per creator with ALL the
 * reel permalinks + includeDownloadedVideo (Issue 1: batch, not per-reel — keeps Apify
 * to 2 runs/creator under the shared pLimit(1)). Returns a shortCode -> downloadedVideo
 * URL map (api.apify.com — public, CORS-star, retained for days, per the Phase-0 spike).
 *
 * Reuses apifyCore (startRun/pollRun/fetchDataset) + keyRotator + the SHARED
 * apifyRunLimiter so it serializes with the list scrape.
 *
 * Throws ApifyError on a fully-blocked run (orchestrator -> creator failed). A reel
 * that simply has no downloadable video is omitted from the map (orchestrator ->
 * that reel skipped). Direct reel URLs avoid the IG block that profile scrapes hit.
 */

import { startRun, pollRun, fetchDataset, ApifyError, apifyRunLimiter, withKeyFailover } from './apifyCore'
import { ACTORS, buildReelVideoScraperInput } from './actors'

// Video download (10 reels) is slower than a list scrape — give it a wider poll budget.
const VIDEO_POLL_MS = 240_000

// ----- Raw item shape from apify~instagram-reel-scraper -----
interface RawReelVideoItem {
  shortCode?: string
  downloadedVideo?: string // stable api.apify.com URL (the includeDownloadedVideo add-on)
  error?: string // present on a blocked/empty item
  requestErrorMessages?: unknown // present on a blocked item
}

/**
 * Pure: map raw reel-video-scraper items to a shortCode -> downloadedVideo URL map.
 * Counts error-records separately so the caller can distinguish "blocked" (all errors,
 * no videos) from "partial" (some reels had no video). Exported for unit testing.
 */
export function extractReelVideos(rawItems: unknown[]): { videos: Map<string, string>; errors: number } {
  const items = rawItems as RawReelVideoItem[]
  const videos = new Map<string, string>()
  let errors = 0
  for (const it of items) {
    if (!it || it.error || it.requestErrorMessages) {
      errors++
      continue
    }
    if (it.shortCode && typeof it.downloadedVideo === 'string' && it.downloadedVideo.length > 0) {
      videos.set(it.shortCode, it.downloadedVideo)
    }
  }
  return { videos, errors }
}

/**
 * Resolve downloadedVideo URLs for a batch of direct reel URLs (one Apify run).
 *
 * @param reelUrls  Direct /reel/<shortcode>/ permalinks (from scrapeTopReels reel.url)
 * @param apifyKeys keysStore.apifyKeys (round-robin via keyRotator)
 * @param signal    AbortSignal for cancellation
 * @returns Map<shortCode, downloadedVideoUrl> — only reels that yielded a video
 */
export async function scrapeReelVideos(
  reelUrls: string[],
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  if (reelUrls.length === 0) return new Map()

  return apifyRunLimiter(async () => {
    const input = buildReelVideoScraperInput(reelUrls)
    // Per-run key failover: a tapped-out account (402) rolls over to a funded key.
    const raw = await withKeyFailover(apifyKeys, async (apiKey) => {
      const { runId, datasetId, keyIndex } = await startRun(ACTORS.REEL_VIDEO_SCRAPER, input, apiKey, signal)
      await pollRun(runId, apiKey, signal, VIDEO_POLL_MS, keyIndex)
      return fetchDataset<RawReelVideoItem>(datasetId, apiKey, signal, keyIndex)
    })

    const { videos, errors } = extractReelVideos(raw)
    // Fully blocked (IG anti-bot): no videos AND every item errored -> creator failed.
    if (videos.size === 0 && errors > 0) {
      throw new ApifyError('RUN_FAILED', 'Reel video scrape was blocked — try again', 0)
    }
    return videos
  })
}
