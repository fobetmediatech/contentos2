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

import { startRun, pollRun, fetchDataset, ApifyError, apifyRunLimiter, withKeyFailover, chunk } from './apifyCore.js'
import { ACTORS, buildReelVideoScraperInput } from './actors.js'

// Video download is slower than a list scrape — give each run a wide poll budget.
const VIDEO_POLL_MS = 240_000

// Resolve videos in SMALL chunks rather than one giant run. A single run for all ~10 reels
// has to download every video before the run SUCCEEDS, which for some accounts blows past the
// poll budget (POLL_TIMEOUT) and — because it's one all-or-nothing run — fails the whole
// creator. Chunking keeps each run short (≤ this many videos) and makes a slow/timed-out chunk
// cost only its own reels: the rest still resolve, and downstream those reels are just skipped.
const VIDEO_CHUNK_SIZE = 4

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

  // Split into small chunks and resolve each as its own (limiter-gated) run. The shared
  // apifyRunLimiter(3) still bounds total concurrency; chunks land on distinct keys.
  const chunks = chunk(reelUrls, VIDEO_CHUNK_SIZE)
  const results = await Promise.all(chunks.map((urls) => scrapeReelVideoChunk(urls, apifyKeys, signal)))
  if (signal?.aborted) return new Map()

  const videos = new Map<string, string>()
  let firstError: ApifyError | null = null
  let anyBlocked = false
  for (const r of results) {
    for (const [code, url] of r.videos) videos.set(code, url)
    if (r.error && !firstError) firstError = r.error
    if (r.blocked) anyBlocked = true
  }

  // As long as SOMETHING resolved, return the partial map — a slow/blocked chunk just loses its
  // own reels (skipped downstream). Only surface a hard failure when nothing resolved at all.
  if (videos.size > 0) return videos
  if (firstError) throw firstError // POLL_TIMEOUT / RATE_LIMITED / RUN_FAILED from a chunk
  if (anyBlocked) throw new ApifyError('RUN_FAILED', 'Reel video scrape was blocked — try again', 0)
  return videos // empty: every chunk returned items but none had a downloadable video
}

/** Resolve one chunk's videos. Never throws except on abort — a timed-out/blocked/rate-limited
 *  chunk resolves to an empty map with the reason recorded so the caller can decide. */
async function scrapeReelVideoChunk(
  reelUrls: string[],
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<{ videos: Map<string, string>; blocked: boolean; error: ApifyError | null }> {
  return apifyRunLimiter(async () => {
    const input = buildReelVideoScraperInput(reelUrls)
    try {
      // Per-run key failover: a tapped-out account (402) rolls over to a funded key.
      const raw = await withKeyFailover(apifyKeys, async (apiKey) => {
        const { runId, datasetId, keyIndex } = await startRun(ACTORS.REEL_VIDEO_SCRAPER, input, apiKey, signal)
        await pollRun(runId, apiKey, signal, VIDEO_POLL_MS, keyIndex)
        return fetchDataset<RawReelVideoItem>(datasetId, apiKey, signal, keyIndex)
      })
      const { videos, errors } = extractReelVideos(raw)
      return { videos, blocked: videos.size === 0 && errors > 0, error: null }
    } catch (err) {
      // Abort propagates (the whole run is being cancelled); any other ApifyError (POLL_TIMEOUT,
      // RUN_FAILED, RATE_LIMITED) is contained so the other chunks still count.
      if (err instanceof ApifyError && err.code === 'ABORTED') throw err
      const error = err instanceof ApifyError ? err : new ApifyError('RUN_FAILED', 'Reel video chunk failed', 0)
      return { videos: new Map<string, string>(), blocked: false, error }
    }
  })
}
