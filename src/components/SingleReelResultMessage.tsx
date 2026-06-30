/**
 * SingleReelResultMessage — renders the LIVE single-reel case-study run inline in chat.
 *
 * Reads useSingleReelStore directly (one active single-reel run at a time), so it needs no
 * props — ChatPage drops it at the `type:'single-reel'` marker. States:
 *   running → a small progress row (pulsing saffron dot + the store's `progress` label)
 *   failed  → the user-safe `error` in a warm-error style
 *   done    → the case-study markdown + "Copy case study" + a collapsible transcript
 *   else    → null
 *
 * The transcript prefers `result.segments` (rendered as `[m:ss] text` lines) and falls back
 * to the raw `result.transcript`; it only appears when the transcript text is non-empty.
 * rosy brown #D3968C is the primary accent; the violet AI tint marks the AI-generated header.
 */

import { useState } from 'react'
import { Bot, ChevronDown, ChevronUp, Copy, Video } from 'lucide-react'
import { useSingleReelStore } from '../store/singleReelStore'
import { CaseStudyMarkdown } from './markdown/CaseStudyMarkdown'
import { ReelTranscriptView } from './ReelTranscriptView'

export function SingleReelResultMessage() {
  const status = useSingleReelStore((s) => s.status)
  const progress = useSingleReelStore((s) => s.progress)
  const result = useSingleReelStore((s) => s.result)
  const error = useSingleReelStore((s) => s.error)

  const [showTranscript, setShowTranscript] = useState(false)
  const [copied, setCopied] = useState(false)

  if (status === 'running') {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(var(--border-rgb),0.08)] text-sm max-w-[80%]">
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent)] opacity-60 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
        </span>
        <span className="text-secondary">{progress || 'Analysing this reel…'}</span>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,92,92,0.12)] flex items-center justify-center mt-0.5">
          <Video size={14} className="text-danger" />
        </div>
        <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-[rgba(224,92,92,0.08)] border border-[rgba(224,92,92,0.30)] text-sm leading-relaxed max-w-[80%]">
          <p className="text-danger">{error ?? 'Could not analyse that reel.'}</p>
        </div>
      </div>
    )
  }

  if (status === 'done' && result) {
    const hasTranscript = result.transcript.trim().length > 0
    return (
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(var(--ai-rgb),0.12)] flex items-center justify-center mt-0.5">
          <Video size={14} className="text-[var(--color-ai-tint)]" />
        </div>
        <div className="flex flex-col gap-3 max-w-[80%] min-w-0">
          {/* Case study — markdown rendered with the themed renderer. */}
          <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(var(--border-rgb),0.08)]">
            <div className="flex items-center gap-2 mb-2">
              <Bot size={14} className="text-[var(--color-ai-tint)] flex-shrink-0" />
              <span className="font-semibold text-primary text-sm">Reel case study</span>
            </div>
            <CaseStudyMarkdown markdown={result.markdown} />
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(result.markdown)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[rgba(var(--accent-rgb),0.12)] text-[var(--color-accent-light)] border border-[rgba(var(--accent-rgb),0.30)] hover:bg-[rgba(var(--accent-rgb),0.20)] transition-colors"
            >
              <Copy size={12} />
              {copied ? 'Copied' : 'Copy case study'}
            </button>
          </div>

          {/* Collapsible transcript */}
          {hasTranscript && (
            <div className="rounded-xl bg-surface border border-[rgba(var(--border-rgb),0.08)] overflow-hidden">
              <button
                onClick={() => setShowTranscript((v) => !v)}
                aria-expanded={showTranscript}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-surface-raised transition-colors"
              >
                <span className="font-mono text-[11px] uppercase tracking-wide text-muted">Transcript</span>
                {showTranscript ? (
                  <ChevronUp size={14} className="text-muted" />
                ) : (
                  <ChevronDown size={14} className="text-muted" />
                )}
              </button>
              {showTranscript && (
                <div className="px-4 pb-3 pt-1 border-t border-[rgba(var(--border-rgb),0.08)]">
                  <ReelTranscriptView result={result} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}
