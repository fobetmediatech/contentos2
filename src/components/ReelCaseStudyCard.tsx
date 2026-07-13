/**
 * ReelCaseStudyCard — per-reel HookMap case study, shown for single-handle profile runs.
 *
 * Self-contained (no store reads) so it's trivially testable. States mirror the per-reel
 * lifecycle:
 *   pending / analyzing → a pulsing saffron dot + label and the reel's view count
 *   skipped             → muted "No video to analyze."
 *   failed              → muted "Couldn’t analyze this reel."
 *   done + result       → the case-study markdown, a metrics line (DM Mono), and a
 *                         collapsible transcript behind a "Transcript" toggle
 *
 * fawn #DFA477 is the primary accent; the violet AI tint marks the AI-generated header.
 */

import { useState } from 'react'
import { Bot, ChevronDown, ChevronUp } from 'lucide-react'
import type { ReelData, ReelCaseStatus } from '../store/reelAnalysisStore'
import type { SingleReelResult } from '../domain/reel'
import { CaseStudyMarkdown } from './markdown/CaseStudyMarkdown'
import { ReelTranscriptView } from './ReelTranscriptView'

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function ReelCaseStudyCard({
  reel,
  status,
  result,
}: {
  reel: ReelData
  status: ReelCaseStatus
  result?: SingleReelResult
}) {
  const [showTranscript, setShowTranscript] = useState(false)

  if (status === 'pending' || status === 'analyzing') {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-surface border border-[rgba(var(--border-rgb),0.08)] text-sm">
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent)] opacity-60 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
        </span>
        <span className="text-secondary">Analysing this reel…</span>
        <span className="ml-auto font-mono text-xs text-muted tabular-nums">{formatViews(reel.videoViewCount)} views</span>
      </div>
    )
  }

  if (status === 'skipped') {
    return (
      <div className="px-4 py-3 rounded-xl bg-surface border border-[rgba(var(--border-rgb),0.08)] text-sm text-muted">
        No video to analyze.
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="px-4 py-3 rounded-xl bg-surface border border-[rgba(var(--border-rgb),0.08)] text-sm text-muted">
        Couldn’t analyze this reel.
      </div>
    )
  }

  if (status === 'done' && result) {
    return (
      <div className="flex flex-col gap-3 min-w-0">
        {/* Case study — markdown rendered with the themed renderer. */}
        <div className="px-4 py-3 rounded-xl bg-surface border border-[rgba(var(--border-rgb),0.08)]">
          <div className="flex items-center gap-2 mb-2">
            <Bot size={14} className="text-[var(--color-ai-tint)] flex-shrink-0" />
            <span className="font-semibold text-primary text-sm">Reel case study</span>
          </div>
          <CaseStudyMarkdown markdown={result.markdown} />

          {/* Metrics — clinical-precision DM Mono row. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-[rgba(var(--border-rgb),0.08)] font-mono text-xs text-muted tabular-nums">
            <span>{formatViews(reel.videoViewCount)} views</span>
            <span>{formatViews(reel.likesCount)} likes</span>
            <span>{formatViews(reel.commentsCount)} comments</span>
          </div>
        </div>

        {/* Collapsible transcript */}
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
      </div>
    )
  }

  // done-without-result (shouldn't happen) — render nothing.
  return null
}
