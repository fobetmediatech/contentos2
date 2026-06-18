/**
 * Single-reel scraper — given ONE direct reel URL, returns its metadata plus a stable
 * api.apify.com downloaded-video URL (apify~instagram-reel-scraper + includeDownloadedVideo).
 *
 * Mirrors reelVideoClient/reelScraper: routes through apifyCore (/api/apify proxy picks the
 * key), serialized on the shared apifyRunLimiter. Throws ApifyError on a fully-blocked run.
 */

import { startRun, pollRun, fetchDataset, ApifyError, apifyRunLimiter, withKeyFailover } from './apifyCore'
import { ACTORS, buildSingleReelInput } from './actors'

const SINGLE_REEL_POLL_MS = 180_000

interface RawSingleReel {
  shortCode?: string
  url?: string
  downloadedVideo?: string
  ownerUsername?: string
  caption?: string | null
  likesCount?: number
  commentsCount?: number
  videoViewCount?: number
  videoDuration?: number
  hashtags?: string[]
  displayUrl?: string
  timestamp?: string
  musicInfo?: unknown
  error?: string
  requestErrorMessages?: unknown
}

export interface ScrapedReel {
  shortCode: string
  url: string
  downloadedVideoUrl: string
  ownerUsername: string
  caption: string
  likesCount: number
  commentsCount: number
  videoViewCount: number
  videoDuration: number
  hashtags: string[]
  displayUrl: string
  timestamp: string
  musicInfo?: unknown
}

/** Pure: map raw reel-scraper items → the first usable ScrapedReel, or null. Exported for tests. */
export function extractSingleReel(rawItems: unknown[]): ScrapedReel | null {
  const items = rawItems as RawSingleReel[]
  const it = items.find(
    (x) => x && !x.error && !x.requestErrorMessages && typeof x.downloadedVideo === 'string' && x.downloadedVideo.length > 0,
  )
  if (!it || !it.shortCode || !it.downloadedVideo) return null
  return {
    shortCode: it.shortCode,
    url: it.url ?? `https://www.instagram.com/reel/${it.shortCode}/`,
    downloadedVideoUrl: it.downloadedVideo,
    ownerUsername: it.ownerUsername ?? '',
    caption: it.caption ?? '',
    likesCount: it.likesCount ?? 0,
    commentsCount: it.commentsCount ?? 0,
    videoViewCount: it.videoViewCount ?? 0,
    videoDuration: it.videoDuration ?? 0,
    hashtags: it.hashtags ?? [],
    displayUrl: it.displayUrl ?? '',
    timestamp: it.timestamp ?? '',
    musicInfo: it.musicInfo,
  }
}

/** Scrape one reel by direct URL. Throws ApifyError if no video could be downloaded. */
export async function scrapeSingleReel(
  reelUrl: string,
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<ScrapedReel> {
  return apifyRunLimiter(async () => {
    const input = buildSingleReelInput(reelUrl)
    const rawItems = await withKeyFailover(apifyKeys, async (apiKey) => {
      const { runId, datasetId, keyIndex } = await startRun(ACTORS.REEL_VIDEO_SCRAPER, input, apiKey, signal)
      await pollRun(runId, apiKey, signal, SINGLE_REEL_POLL_MS, keyIndex)
      return fetchDataset<RawSingleReel>(datasetId, apiKey, signal, keyIndex)
    })
    const reel = extractSingleReel(rawItems)
    if (!reel) throw new ApifyError('RUN_FAILED', 'No downloadable video for that reel (private, deleted, or blocked)', 0)
    return reel
  })
}
