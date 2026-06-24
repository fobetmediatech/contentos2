import type { ReelData } from '../store/reelAnalysisStore'
import type { SingleReelResult } from '../store/singleReelStore'

export const SUMMARY_INPUT_TOKEN_BUDGET = 100_000
export const TRANSCRIPT_PREFIX_CHARS = 600

export interface ReelDigest { shortCode: string; views: number; likes: number; comments: number; hookOpening: string; videoSignals: string }

export function estimateTokens(text: string): number { return Math.ceil(text.length / 4) }

export function buildReelDigest(result: SingleReelResult, reel: ReelData): ReelDigest {
  const opening = (result.segments?.[0]?.text || result.transcript || '').slice(0, TRANSCRIPT_PREFIX_CHARS)
  const va = result.videoAnalysis ?? ({} as SingleReelResult['videoAnalysis'])
  const videoSignals = [va.dominant_framing, va.trending_audio_hint, va.cuts_count != null ? `${va.cuts_count} cuts` : '']
    .filter(Boolean).join(' · ')
  return { shortCode: reel.shortCode, views: reel.videoViewCount, likes: reel.likesCount, comments: reel.commentsCount, hookOpening: opening, videoSignals }
}

export function digestText(d: ReelDigest): string {
  return `Reel ${d.shortCode} — ${d.views} views, ${d.likes} likes, ${d.comments} comments\nHook: ${d.hookOpening}\nVideo: ${d.videoSignals}`
}

export function planDigestChunks(digests: ReelDigest[], budget: number): ReelDigest[][] {
  const chunks: ReelDigest[][] = []
  let cur: ReelDigest[] = []
  let curTokens = 0
  for (const d of digests) {
    const t = estimateTokens(digestText(d))
    if (cur.length > 0 && curTokens + t > budget) { chunks.push(cur); cur = []; curTokens = 0 }
    cur.push(d); curTokens += t
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}
