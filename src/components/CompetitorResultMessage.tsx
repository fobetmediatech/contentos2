/**
 * CompetitorResultMessage — renders a completed competitor analysis INLINE in the chat.
 *
 * Phase 2 (results-as-messages): instead of rendering from transient store status, a finished
 * competitor run is snapshotted into a `type:'result'` conversation message (so it persists
 * across reloads and interleaves with the chat). This component renders that snapshot. The
 * select → "Analyze N reels" interactivity is threaded in via props (the selection lives in
 * ChatPage state, shared across results).
 */

import { useState } from 'react'
import { Bot, CheckCircle, Check, Clipboard, Download, Video, X } from 'lucide-react'
import type { CompetitorResultPayload } from '../store/analysisStore'
import { CompetitorCard } from './CompetitorCard'
import { COMPETITOR_CATEGORIES } from '../shared/utils/categories'
import { deriveCompetitorView } from './competitorResultView'
import { formatForClipboard, generateCSV, downloadCSV, copyToClipboard } from '../shared/utils/export'

interface Props {
  payload: CompetitorResultPayload
  selectedHandles: string[]
  onToggleSelect: (handle: string) => void
  onClearSelection: () => void
  onAnalyzeReels: () => void
  onStartOver: () => void
  /** True while a reel run is active — selection is disabled (you can't re-pick mid-run). */
  reelActive: boolean
}

export function CompetitorResultMessage({
  payload,
  selectedHandles,
  onToggleSelect,
  onClearSelection,
  onAnalyzeReels,
  onStartOver,
  reelActive,
}: Props) {
  const { competitors, summary, niche, didExpand } = payload
  const { profileMap, cohortAvgER, top, trending } = deriveCompetitorView(payload)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await copyToClipboard(formatForClipboard({ competitors, profiles: payload.profiles, sourceHandles: [] }))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadCSV = () => {
    const csv = generateCSV({ competitors, profiles: payload.profiles, sourceHandles: [] })
    downloadCSV(csv, `competitors-${niche || 'results'}.csv`)
  }

  return (
    <>
      {/* Completion bubble */}
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center mt-0.5">
          <Bot size={14} className="text-[#E07B3A]" />
        </div>
        <div className="flex flex-col gap-2 max-w-[80%]">
          <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] text-sm leading-relaxed">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle size={14} className="text-success flex-shrink-0" />
              <span className="font-semibold text-primary">Analysis complete</span>
            </div>
            <p className="text-secondary">
              Found {competitors.length} competitor{competitors.length !== 1 ? 's' : ''}
              {niche ? ` in the ${niche} space` : ''}.
              Ranked by engagement, location fit, and partnership readiness.
            </p>
            {didExpand && (
              <p className="text-xs text-warning mt-1.5">
                Sparse niche — results may be limited. Try a different reference account for a broader pool.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onStartOver}
              className="px-4 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
            >
              Start over
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
            >
              {copied ? <Check size={13} className="text-success" /> : <Clipboard size={13} />}
              {copied ? 'Copied!' : 'Copy for slides'}
            </button>
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
            >
              <Download size={13} />
              Download CSV
            </button>
          </div>
        </div>
      </div>

      {/* AI summary — violet AI tint + Gemini eyebrow per DESIGN.md */}
      {summary && (
        <div className="px-4 py-3 bg-[rgba(167,139,250,0.08)] border border-[#A78BFA]/20 rounded-xl">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#A78BFA] mb-1">✦ Gemini</p>
          <p className="text-sm text-[#C4B5FD] leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Card grids */}
      {top.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#7A6A54] uppercase tracking-wide mb-3">
            {COMPETITOR_CATEGORIES.top.sectionLabel}
          </p>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {top.map((c) => (
              <CompetitorCard
                key={c.username}
                competitor={c}
                profile={profileMap.get(c.username)}
                cohortAvgER={cohortAvgER}
                isSelected={selectedHandles.includes(c.username)}
                onSelect={reelActive ? undefined : onToggleSelect}
              />
            ))}
          </div>
        </div>
      )}
      {trending.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#7A6A54] uppercase tracking-wide mb-3">
            {COMPETITOR_CATEGORIES.trending.sectionLabel}
          </p>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {trending.map((c) => (
              <CompetitorCard
                key={c.username}
                competitor={c}
                profile={profileMap.get(c.username)}
                cohortAvgER={cohortAvgER}
                isSelected={selectedHandles.includes(c.username)}
                onSelect={reelActive ? undefined : onToggleSelect}
              />
            ))}
          </div>
        </div>
      )}

      {/* Selection CTA — pick creators → analyze their reels */}
      {selectedHandles.length > 0 && !reelActive && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onClearSelection}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#A09080] border border-[#3D2E1E] rounded-xl hover:text-[#F5E6D3] hover:border-[#5C4A30] transition-colors"
          >
            <X size={13} />
            Clear
          </button>
          <button
            onClick={onAnalyzeReels}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#E07B3A] text-[#1A1410] rounded-xl hover:bg-[#C96A2A] transition-colors"
          >
            <Video size={14} />
            Analyze {selectedHandles.length} creator{selectedHandles.length !== 1 ? 's' : ''} reels
          </button>
        </div>
      )}
    </>
  )
}
