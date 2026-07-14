/**
 * Transcript-only reel client — posts a reel's video URL to /api/get-transcript (the
 * lightweight, transcript-only endpoint with a fast ≤15 MB inline path) and returns just
 * the spoken transcript. Used by the voice-profile build, which only needs the words — NOT
 * the full /api/analyze-single-reel (video mechanics + markdown), which it would discard.
 *
 * Best-effort, mirroring reelHookmap: a failed/undeployed call returns null (that reel just
 * yields no transcript) and never throws.
 */
import { getClerkSessionToken } from './clerkToken'

/** Pure: pull the transcript string out of the /api/get-transcript response, or null. */
export function parseTranscriptResponse(json: unknown): string | null {
  const t = (json as { result?: { transcript?: unknown } } | null)?.result?.transcript
  return typeof t === 'string' ? t : null
}

/** Fetch ONE reel's transcript via /api/get-transcript. Returns null on any failure. */
export async function getReelTranscript(
  shortCode: string,
  videoUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const body = JSON.stringify({ downloadedVideoUrl: videoUrl, shortCode })
  const post = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = await getClerkSessionToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    return fetch('/api/get-transcript', { method: 'POST', headers, body, signal })
  }
  try {
    let res = await post()
    if (res.status === 401) res = await post() // token refresh, mirrors reelHookmap
    if (!res.ok) return null
    return parseTranscriptResponse(await res.json())
  } catch {
    return null
  }
}
