/**
 * ReportPage — dedicated full-page view of the cross-profile niche report (Phase 2 refinement).
 *
 * Reads the report from the store (populated by a prior deep run in the chat) — does NOT
 * run its own pipeline, so it must NOT reset the store on mount (that would wipe the report).
 * Reuses DeepReportCard for identical rendering, adds Print / Save as PDF (print CSS isolates
 * .report-printable). Empty state when no report exists yet.
 */

import { useNavigate } from 'react-router-dom'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { DeepReportCard } from '../components/InlineReelResults'

export function ReportPage() {
  const navigate = useNavigate()
  const deepReport = useReelAnalysisStore((s) => s.deepReport)

  if (!deepReport) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-[#F5EDD6] mb-2">No report yet</h1>
        <p className="text-[#7A6A54] mb-6">
          Run a deep report from the chat, then come back here for the full-page, client-ready view.
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
        <h1 className="text-2xl font-bold text-[#F5EDD6]">Niche Report</h1>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-xl bg-[#2C2218] text-[#C4A882] border border-[rgba(245,237,214,0.12)] hover:border-[#E07B3A]/40 transition-colors text-sm font-semibold"
        >
          Print / Save as PDF
        </button>
      </div>
      <div className="report-printable">
        <DeepReportCard report={deepReport} />
      </div>
    </div>
  )
}
