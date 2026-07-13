import type { ReelData } from '../store/reelAnalysisStore'
import type { SingleReelResult } from '../domain/reel'
import { getClerkSessionToken } from './clerkToken'

/**
 * Probe whether the single-reel analyzer is deployed (404 under plain `vite dev`). Mirrors
 * useReelAnalysis.deepFnAvailable: a 404 means "not deployed → skip enrichment"; any other
 * status (or a network error) means proceed. Avoids wasting an Apify video scrape when the
 * function can't run anyway.
 */
export async function singleReelFnAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch('/api/analyze-single-reel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    })
    return res.status !== 404
  } catch {
    return true
  }
}

export async function analyzeReelHookmap(
  handle: string,
  reel: ReelData,
  videoUrl: string,
  signal?: AbortSignal,
): Promise<SingleReelResult | null> {
  const body = JSON.stringify({
    downloadedVideoUrl: videoUrl,
    shortCode: reel.shortCode,
    apify: {
      ownerUsername: handle,
      caption: reel.caption,
      likesCount: reel.likesCount,
      commentsCount: reel.commentsCount,
      videoViewCount: reel.videoViewCount,
      videoDuration: reel.videoDuration,
      hashtags: reel.hashtags,
      musicInfo: reel.musicInfo,
    },
  })
  const post = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = await getClerkSessionToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    return fetch('/api/analyze-single-reel', { method: 'POST', headers, body, signal })
  }
  try {
    let res = await post()
    if (res.status === 401) res = await post()
    if (!res.ok) return null
    const json = (await res.json()) as { result: SingleReelResult }
    return json.result
  } catch {
    return null
  }
}
