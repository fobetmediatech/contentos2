/**
 * TranscriptResultMessage — renders the live transcript-only view for a reel.
 *
 * Reads useTranscriptStore directly (fully independent from singleReelStore).
 * ChatPage drops it at the `type:'transcript'` marker. Shows only the spoken
 * transcript (timestamped segments or raw text), not a case-study breakdown.
 *
 * States: running → pulsing saffron dot; failed → error; done → segments + copy.
 */

import { useState } from 'react'
import { Copy, FileText, Video } from 'lucide-react'
import { useTranscriptStore } from '../store/transcriptStore'
import type { TranscriptResultPayload } from '../domain/chat'

/** Seconds → m:ss (e.g. 75 → "1:15"). Negative / non-finite values clamp to 0:00. */
function fmtTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${rem.toString().padStart(2, '0')}`
}

interface Props {
  /** When provided, renders statically from the persisted payload (results-as-messages). */
  payload?: TranscriptResultPayload
}

export function TranscriptResultMessage({ payload }: Props = {}) {
  const status = useTranscriptStore((s) => s.status)
  const progress = useTranscriptStore((s) => s.progress)
  const liveResult = useTranscriptStore((s) => s.result)
  const error = useTranscriptStore((s) => s.error)

  // Static mode: render persisted payload without touching the store.
  const result = payload ? { transcript: payload.transcript, segments: payload.segments } : liveResult

  const [copied, setCopied] = useState(false)

  // In static mode, always render the done view directly.
  if (!payload && status === 'running') {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] text-sm max-w-[80%]">
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#E07B3A] opacity-60 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#E07B3A]" />
        </span>
        <span className="text-secondary">{progress || 'Transcribing reel…'}</span>
      </div>
    )
  }

  if (!payload && status === 'failed') {
    return (
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,92,92,0.12)] flex items-center justify-center mt-0.5">
          <Video size={14} className="text-danger" />
        </div>
        <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-[rgba(224,92,92,0.08)] border border-[rgba(224,92,92,0.30)] text-sm leading-relaxed max-w-[80%]">
          <p className="text-danger">{error ?? 'Could not transcribe that reel.'}</p>
        </div>
      </div>
    )
  }

  if ((payload || status === 'done') && result) {
    const hasTranscript = result.transcript.trim().length > 0

    const fullText =
      result.segments.length > 0
        ? result.segments.map((seg) => `[${fmtTime(seg.start)}] ${seg.text}`).join('\n')
        : result.transcript

    const handleCopy = () => {
      void navigator.clipboard.writeText(fullText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    return (
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center mt-0.5">
          <FileText size={14} className="text-[#E07B3A]" />
        </div>
        <div className="flex flex-col gap-3 max-w-[80%] min-w-0">
          <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted">Transcript</span>
              {hasTranscript && (
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-[rgba(224,123,58,0.12)] text-[#F4A97B] border border-[#E07B3A]/30 hover:bg-[rgba(224,123,58,0.20)] transition-colors"
                >
                  <Copy size={11} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>

            {hasTranscript ? (
              result.segments.length > 0 ? (
                <div className="space-y-1.5">
                  {result.segments.map((seg, i) => (
                    <p key={`${i}-${seg.start}`} className="text-sm text-secondary leading-relaxed">
                      <span className="font-mono text-xs text-[#E07B3A] tabular-nums mr-2">
                        [{fmtTime(seg.start)}]
                      </span>
                      {seg.text}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-secondary leading-relaxed whitespace-pre-wrap">{result.transcript}</p>
              )
            ) : (
              <p className="text-sm text-muted italic">No spoken content detected in this reel.</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return null
}
