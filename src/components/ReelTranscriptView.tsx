/**
 * ReelTranscriptView — renders a single reel's transcript inside an already-revealed
 * container (the caller owns the collapse / show-hide chrome).
 *
 * Prefers `result.segments`, rendered as `[m:ss] text` lines with the saffron timestamp,
 * and falls back to the raw `result.transcript` when there are no segments. Extracted from
 * SingleReelResultMessage so the per-reel case-study cards can reuse the exact rendering.
 */

import type { SingleReelResult } from '../store/singleReelStore'

/** Seconds → m:ss (e.g. 75 → "1:15"). Negative / non-finite values clamp to 0:00. */
function fmtTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${rem.toString().padStart(2, '0')}`
}

export function ReelTranscriptView({ result }: { result: SingleReelResult }) {
  if (result.segments.length > 0) {
    return (
      <div className="space-y-1.5">
        {result.segments.map((seg, i) => (
          <p key={`${i}-${seg.start}`} className="text-sm text-secondary leading-relaxed">
            <span className="font-mono text-xs text-[var(--color-accent)] tabular-nums mr-2">
              [{fmtTime(seg.start)}]
            </span>
            {seg.text}
          </p>
        ))}
      </div>
    )
  }
  return <p className="text-sm text-secondary leading-relaxed whitespace-pre-wrap">{result.transcript}</p>
}
