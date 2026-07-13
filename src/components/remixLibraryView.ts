import type { ContentRecord } from '../lib/corpus'

/** Pure: reels that have a transcript, matching the query in caption or handle. */
export function filterReels(reels: ContentRecord[], query: string): ContentRecord[] {
  const q = query.trim().toLowerCase()
  return reels.filter((r) => {
    if (!r.transcript || !r.transcript.trim()) return false
    if (!q) return true
    return (r.caption ?? '').toLowerCase().includes(q) || (r.creatorUsername ?? '').toLowerCase().includes(q)
  })
}
