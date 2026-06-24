/**
 * ReportPage — dedicated full-page view of the creator hook summary (Phase 2 refinement).
 *
 * Reads the hook summary from the store (populated by a single-handle reel run in the chat) — does NOT
 * run its own pipeline, so it must NOT reset the store on mount (that would wipe the summary).
 * Renders HookSummaryCard full-page with Print / Save as PDF. Empty state when no summary exists yet.
 */

import { useNavigate } from 'react-router-dom'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import type { CreatorAnalysisState } from '../store/reelAnalysisStore'
import { HookSummaryCard } from '../components/HookSummaryCard'
import { ReelCaseStudyCard } from '../components/ReelCaseStudyCard'

export function ReportPage() {
  const navigate = useNavigate()
  const creatorStates = useReelAnalysisStore((s) => s.creatorStates)
  const creator = firstCreatorWithSummary(creatorStates)
  const summary = creator?.hookSummary

  if (!creator || !summary) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-[#F5EDD6] mb-2">No report yet</h1>
        <p className="text-[#7A6A54] mb-6">
          Analyze a single creator's reels from the chat, then come back here for the full-page summary.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2.5 rounded-xl bg-[#E07B3A] text-white font-semibold hover:bg-[#C4612A] transition-colors"
        >
          Go to chat
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-2xl font-bold text-[#F5EDD6]">Reel Hook Report</h1>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-xl bg-[#2C2218] text-[#C4A882] border border-[rgba(245,237,214,0.12)] hover:border-[#E07B3A]/40 transition-colors text-sm font-semibold"
        >
          Print / Save as PDF
        </button>
      </div>
      <div className="report-printable flex flex-col gap-6">
        <HookSummaryCard summary={summary} />

        {/* Individual reel case studies — included in the page AND the PDF. */}
        <section>
          <h2 className="text-lg font-semibold text-[#F5EDD6] mb-3">Reel-by-reel breakdown</h2>
          <div className="flex flex-col gap-4">
            {creator.reels.map((reel) => (
              <ReelCaseStudyCard
                key={reel.shortCode}
                reel={reel}
                status={creator.caseStudyStatus?.[reel.shortCode] ?? 'done'}
                result={creator.caseStudies?.[reel.shortCode]}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function firstCreatorWithSummary(creatorStates: Record<string, CreatorAnalysisState>) {
  for (const s of Object.values(creatorStates)) if (s.hookSummary) return s
  return undefined
}
