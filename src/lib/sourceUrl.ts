/**
 * Source-URL detection for Script Studio. A reference video is either an Instagram reel
 * (reuses the reel-URL parser) or a YouTube Short/video. Pure — no I/O, unit-tested.
 */
import { parseReelUrl } from './reelUrl'

export type SourcePlatform = 'instagram' | 'youtube'

// youtube.com/shorts/<id>, youtu.be/<id>, or youtube.com/watch?v=<id> (any subdomain).
const YOUTUBE_RE = /(?:youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{6,})/i

/** Which platform a pasted URL belongs to, or null if it's neither. */
export function detectSourcePlatform(input: string): SourcePlatform | null {
  if (typeof input !== 'string' || !input.trim()) return null
  if (parseReelUrl(input)) return 'instagram'
  if (YOUTUBE_RE.test(input)) return 'youtube'
  return null
}
