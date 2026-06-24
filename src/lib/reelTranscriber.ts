/**
 * Reel transcriber — drives @handle-scraped reels through the SAME single-reel analyzer
 * (`/api/analyze-single-reel`) the URL-paste path uses, to produce full spoken transcripts
 * for the corpus + gallery.
 *
 * Mirrors the deep pipeline's video step: ONE batch Apify run resolves stable video URLs,
 * then each reel is analyzed via the serverless function (capped concurrency). Cache-first
 * (`getCachedSingleReel`) so re-runs are free AND the cache is shared with the URL-based
 * single-reel feature — analyzing a reel by handle warms the cache for a later URL paste and
 * vice-versa. Best-effort throughout: a reel without a downloadable video, or a failed call,
 * simply yields no transcript for that reel and never throws.
 */

import pLimit from 'p-limit'
import type { ReelData } from '../store/reelAnalysisStore'
import { scrapeReelVideos } from './reelVideoClient'
import { getCachedSingleReel, setCachedSingleReel } from './singleReelCache'
import { analyzeReelHookmap } from './reelHookmap'

// Conservative: the serverless analyzer uses a SINGLE Gemini key (no server rotation), so
// this caps concurrent Gemini uploads — same reasoning as the deep path's deepLimiter.
const transcribeLimiter = pLimit(3)

// Re-export singleReelFnAvailable from reelHookmap for backward compatibility
export { singleReelFnAvailable } from './reelHookmap'

/**
 * Transcribe a creator's reels. Returns a map of shortCode → transcript for the reels that
 * produced one (reels with no speech yield ""; reels with no downloadable video are absent).
 */
export async function transcribeReels(
  handle: string,
  reels: ReelData[],
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const transcripts: Record<string, string> = {}
  if (reels.length === 0) return transcripts

  // Cache-first: a cached single-reel result already carries the transcript — no network.
  const uncached: ReelData[] = []
  for (const reel of reels) {
    const cached = await getCachedSingleReel(reel.shortCode)
    if (cached) transcripts[reel.shortCode] = cached.transcript
    else uncached.push(reel)
  }
  if (signal?.aborted || uncached.length === 0) return transcripts

  // ONE batch Apify run resolves stable video URLs for the UNCACHED reels only.
  const videos = await scrapeReelVideos(
    uncached.map((r) => r.url),
    apifyKeys,
    signal,
  )
  if (signal?.aborted) return transcripts

  await Promise.all(
    uncached.map((reel) =>
      transcribeLimiter(async () => {
        if (signal?.aborted) return
        const videoUrl = videos.get(reel.shortCode)
        if (!videoUrl) return // no downloadable video → skip (no transcript for this reel)
        const result = await analyzeReelHookmap(handle, reel, videoUrl, signal)
        if (!result) return
        void setCachedSingleReel(reel.shortCode, result) // best-effort: makes re-runs free
        transcripts[reel.shortCode] = result.transcript
      }),
    ),
  )
  return transcripts
}
