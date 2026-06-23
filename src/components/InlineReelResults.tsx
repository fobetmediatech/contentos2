import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { ProgressSteps } from './ProgressSteps'
import type {
  CreatorAnalysisState,
  ReelData,
  ReelAnalysis,
  SynthesisOutput,
  StoredDeepReelAnalysis,
  DeepReelStatus,
} from '../store/reelAnalysisStore'
import type { DeepNicheReport } from '../ai/prompts/deepReelAnalysis'
import { copyToClipboard, downloadMarkdown, formatDeepReportMarkdown } from '../shared/utils/export'
import { ReelCaseStudyCard } from './ReelCaseStudyCard'
import { HookSummaryCard } from './HookSummaryCard'

const REEL_STEPS = ['Scraping reels', 'Analyzing hooks', 'Done']

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

interface Props {
  handles: string[]
  creatorStates: Record<string, CreatorAnalysisState>
  synthesisStatus: 'idle' | 'running' | 'done' | 'failed'
  synthesis: SynthesisOutput | null
  synthesisError: string | null
  /** Prefill the chat input — used by the "remix for my niche" button to hand off
   *  the winning patterns to the content copilot. */
  onSuggest?: (text: string) => void
  /** Kick off the DEEP multimodal report (Gemini watches the videos) for these handles. */
  onDeepReport?: (handles: string[]) => void
  /** Cross-profile niche report (Phase 2) — rendered above the per-creator sections. */
  deepReport?: DeepNicheReport | null
  deepReportStatus?: 'idle' | 'running' | 'done' | 'failed' | 'unavailable'
}

export function InlineReelResults({ handles, creatorStates, synthesisStatus, synthesis, synthesisError, onSuggest, onDeepReport, deepReport, deepReportStatus }: Props) {
  // A deep run is active once any creator has per-reel deep status seeded.
  const anyDeep = handles.some((h) => {
    const s = creatorStates[h]
    return s?.deepStatus && Object.keys(s.deepStatus).length > 0
  })
  const anyRunning = handles.some((h) => {
    const s = creatorStates[h]
    return s?.status === 'scraping' || s?.status === 'analyzing'
  })

  return (
    <div className="w-full mt-2">
      {/* Cross-profile niche report (Phase 2) — the headline deliverable, above everything. */}
      {deepReportStatus === 'running' && (
        <div className="mb-8 px-5 py-5 bg-[#1E1A2E] border border-[#A78BFA]/20 rounded-xl animate-pulse">
          <p className="text-sm text-[#A78BFA]">Synthesizing the niche report…</p>
        </div>
      )}
      {deepReportStatus === 'done' && deepReport && (
        <>
          <DeepReportCard report={deepReport} />
          <div className="-mt-5 mb-8">
            <Link to="/report" className="text-sm font-medium text-[#E07B3A] hover:underline">
              Open full report ↗
            </Link>
          </div>
        </>
      )}
      {deepReportStatus === 'failed' && (
        <div className="mb-8 px-4 py-3 bg-[#2C1818] border border-danger/30 rounded-xl text-sm text-danger">
          Niche report synthesis failed — the per-creator analyses below are still available.
        </div>
      )}
      {deepReportStatus === 'unavailable' && (
        <div className="mb-8 px-4 py-3 bg-[rgba(217,119,6,0.1)] border border-warning/30 rounded-xl text-sm text-secondary leading-relaxed">
          <span className="font-semibold text-warning">Deep report needs the analysis backend.</span>{' '}
          The video breakdown runs in a serverless function that isn't served by <code className="font-mono text-xs">vite dev</code> — run{' '}
          <code className="font-mono text-xs">vercel dev</code> or use the deployed app. Your reel breakdowns below still work.
        </div>
      )}
      {/* Deep-report CTA — offer to enrich the quick results with real video analysis. */}
      {onDeepReport && handles.length > 0 && !anyDeep && (
        <button
          onClick={() => onDeepReport(handles)}
          disabled={anyRunning}
          className="mb-6 w-full px-4 py-3 text-sm font-semibold rounded-xl bg-[#A78BFA]/15 text-[#C4B5FD] border border-[#A78BFA]/30 hover:bg-[#A78BFA]/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ✦ Generate deep report — watch the videos (real spoken + visual hooks)
        </button>
      )}
      {synthesisStatus === 'running' && <SynthesisLoadingCard />}
      {synthesisStatus === 'done' && synthesis && <SynthesisCard synthesis={synthesis} onSuggest={onSuggest} />}
      {synthesisStatus === 'failed' && (
        <div className="mb-4 px-4 py-3 bg-[#2C1818] border border-danger/30 rounded-xl text-sm text-danger">
          Synthesis failed: {synthesisError ?? 'Unknown error'}
        </div>
      )}
      {handles.map(handle => {
        const state = creatorStates[handle]
        if (!state) return null
        return <CreatorSection key={handle} state={state} singleHandle={handles.length === 1} />
      })}
    </div>
  )
}

function SynthesisLoadingCard() {
  return (
    <div className="mb-6 px-5 py-5 bg-[#1E1A2E] border border-[#A78BFA]/20 rounded-xl animate-pulse">
      <p className="text-sm text-[#A78BFA]">Synthesizing niche patterns…</p>
    </div>
  )
}

function SynthesisCard({ synthesis, onSuggest }: { synthesis: SynthesisOutput; onSuggest?: (text: string) => void }) {
  return (
    <div className="mb-8 px-5 py-5 bg-[#1E1A2E] border border-[#A78BFA]/20 rounded-xl">
      <h2 className="text-lg font-semibold text-[#F5EDD6] mb-4">Hook patterns dominating this niche</h2>

      <div className="flex flex-wrap gap-2 mb-5">
        {synthesis.topPatterns.map((pattern, i) => (
          <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#A78BFA]/10 border border-[#A78BFA]/20 text-sm text-[#A78BFA]">
            <span>{pattern.archetype}</span>
            <span className="text-[#A78BFA]/60 text-xs">×{pattern.count}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="px-3 py-2 bg-[#13101E] rounded-lg">
          <p className="text-xs text-[#7A6A54] mb-0.5">Median views</p>
          <p className="text-sm font-mono text-[#C4A882]">{formatViews(synthesis.benchmarks.medianViews)}</p>
        </div>
        <div className="px-3 py-2 bg-[#13101E] rounded-lg">
          <p className="text-xs text-[#7A6A54] mb-0.5">Likes / views</p>
          <p className="text-sm font-mono text-[#C4A882]">{(synthesis.benchmarks.likesViewsRatio * 100).toFixed(1)}%</p>
        </div>
        <div className="px-3 py-2 bg-[#13101E] rounded-lg">
          <p className="text-xs text-[#7A6A54] mb-0.5">Comments / likes</p>
          <p className="text-sm font-mono text-[#C4A882]">{(synthesis.benchmarks.commentsLikesRatio * 100).toFixed(1)}%</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold text-[#A78BFA] uppercase tracking-wide mb-2">Replicate</h3>
          <ul className="space-y-2">
            {synthesis.replicateTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#C4A882]">
                <span className="text-[#A78BFA] mt-0.5">+</span>{tip}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-danger uppercase tracking-wide mb-2">Avoid</h3>
          <ul className="space-y-2">
            {synthesis.avoidTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#C4A882]">
                <span className="text-danger mt-0.5">–</span>{tip}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Remix → hand the winning patterns to the content copilot */}
      {onSuggest && synthesis.topPatterns.length > 0 && (
        <button
          onClick={() =>
            onSuggest(
              `Write me 5 reel hooks for my niche using these winning patterns: ${synthesis.topPatterns
                .map((p) => p.archetype)
                .join(', ')}.`,
            )
          }
          className="mt-5 w-full px-4 py-2.5 text-sm font-semibold rounded-xl bg-[#A78BFA]/15 text-[#C4B5FD] border border-[#A78BFA]/30 hover:bg-[#A78BFA]/25 transition-colors"
        >
          ✦ Generate hooks like these for my niche
        </button>
      )}
    </div>
  )
}

function CreatorSection({ state, singleHandle }: { state: CreatorAnalysisState; singleHandle: boolean }) {
  const [expanded, setExpanded] = useState(false)

  const stepIndex = state.status === 'scraping' ? 1 : state.status === 'analyzing' ? 2 : 3

  if (state.status === 'failed') {
    return (
      <div className="mb-4 px-4 py-3 bg-[#2C1818] border border-danger/30 rounded-xl text-sm text-danger">
        @{state.handle} — {state.error ?? 'analysis failed'}
      </div>
    )
  }

  if (state.status === 'no-reels') {
    return (
      <div className="mb-4 px-4 py-3 bg-[#2C2218] border border-[#E07B3A]/20 rounded-xl text-sm text-[#C4A882]">
        @{state.handle} — no recent Reels found. Try a more active creator.
      </div>
    )
  }

  // Deep report: once per-reel deep status is seeded, render the deep grid (progressive —
  // reels flip from analyzing -> done/failed/skipped as the function calls return).
  const deepStatus = state.deepStatus ?? {}
  if (Object.keys(deepStatus).length > 0) {
    const doneCount = Object.values(deepStatus).filter((s) => s === 'done').length
    return (
      <div className="mb-8">
        <h3 className="text-[#F5EDD6] font-medium mb-3">
          @{state.handle}
          <span className="text-[#7A6A54] text-sm ml-2 font-normal">
            {doneCount}/{state.reels.length} reels enriched
          </span>
        </h3>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {state.reels.map((reel) => (
            <DeepReelCard
              key={reel.shortCode}
              reel={reel}
              status={deepStatus[reel.shortCode] ?? 'pending'}
              analysis={state.deepAnalyses?.[reel.shortCode]}
            />
          ))}
        </div>
      </div>
    )
  }

  if (state.status === 'scraping' || state.status === 'analyzing') {
    return (
      <div className="mb-6">
        <h3 className="text-[#F5EDD6] font-medium mb-3">@{state.handle}</h3>
        <ProgressSteps currentStep={stepIndex} steps={REEL_STEPS} />
      </div>
    )
  }

  return (
    <div className="mb-8">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 mb-4 text-[#F5EDD6] font-medium hover:text-[#E07B3A] transition-colors"
      >
        @{state.handle} — {Object.keys(state.analyses).length} reels analyzed
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        singleHandle ? (
          <div className="flex flex-col gap-4">
            {state.hookSummary && <HookSummaryCard summary={state.hookSummary} />}
            {state.reels.map(reel => (
              <ReelCaseStudyCard
                key={reel.shortCode}
                reel={reel}
                status={state.caseStudyStatus?.[reel.shortCode] ?? 'pending'}
                result={state.caseStudies?.[reel.shortCode]}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-2 xl:grid-cols-3">
            {state.reels.map(reel => (
              <ReelCard key={reel.shortCode} reel={reel} analysis={state.analyses[reel.shortCode]} />
            ))}
          </div>
        )
      )}
    </div>
  )
}

function ReelCard({ reel, analysis }: { reel: ReelData; analysis?: ReelAnalysis }) {
  const [showFull, setShowFull] = useState(false)

  return (
    <div className="bg-[#2C2218] border border-[rgba(245,237,214,0.08)] rounded-xl overflow-hidden">
      {reel.displayUrl && (
        <img
          src={reel.displayUrl}
          alt="Reel thumbnail"
          className="w-full aspect-square object-cover bg-[#1A1410]"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div className="p-3">
        <p className="text-xs text-[#7A6A54] font-mono">{formatViews(reel.videoViewCount)} views</p>
        {analysis?.openingLine && (
          <p className="text-xs text-[#F5EDD6] mt-1 leading-snug italic">"{analysis.openingLine}"</p>
        )}
        {analysis && (
          <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20">
            {analysis.hookArchetype}
          </span>
        )}
        {analysis?.lowConfidenceNote && (
          <p className="text-xs text-[#7A6A54] mt-1 italic">{analysis.lowConfidenceNote}</p>
        )}
        {analysis && (
          <button
            onClick={() => setShowFull(f => !f)}
            className="text-xs text-[#E07B3A] mt-2 hover:underline"
          >
            {showFull ? 'Hide analysis' : 'Show full analysis'}
          </button>
        )}
        {showFull && analysis && (
          <div className="mt-2 text-xs text-[#C4A882] space-y-1">
            <p><span className="text-[#7A6A54]">Retention:</span> {analysis.retentionMechanism}</p>
            <p><span className="text-[#7A6A54]">Psychology:</span> {analysis.psychologyTrigger}</p>
            <p><span className="text-[#7A6A54]">Template:</span> {analysis.replicationTemplate}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ----- Deep (multimodal) reel rendering -----

const DEEP_BADGES: Record<DeepReelStatus, { label: string; cls: string }> = {
  pending: { label: 'queued', cls: 'bg-[#7A6A54]/15 text-[#7A6A54] border-[#7A6A54]/30' },
  fetching: { label: 'fetching', cls: 'bg-[#E07B3A]/15 text-[#E07B3A] border-[#E07B3A]/30' },
  analyzing: { label: 'analyzing…', cls: 'bg-[#E07B3A]/15 text-[#E07B3A] border-[#E07B3A]/30 animate-pulse' },
  done: { label: 'done', cls: 'bg-[#A78BFA]/15 text-[#A78BFA] border-[#A78BFA]/30' },
  failed: { label: 'failed', cls: 'bg-danger/15 text-danger border-danger/30' },
  skipped: { label: 'no video', cls: 'bg-[#7A6A54]/15 text-[#7A6A54] border-[#7A6A54]/30' },
}

/**
 * Deep per-reel card — renders the multimodal analysis (real spoken + visual hook,
 * grounded in the video) with a live per-reel status badge. AI-generated content uses
 * the violet tint per DESIGN.md.
 */
function DeepReelCard({ reel, status, analysis }: { reel: ReelData; status: DeepReelStatus; analysis?: StoredDeepReelAnalysis }) {
  const [showFull, setShowFull] = useState(false)
  const badge = DEEP_BADGES[status]

  return (
    <div className="bg-[#2C2218] border border-[rgba(245,237,214,0.08)] rounded-xl overflow-hidden flex">
      {reel.displayUrl && (
        <img
          src={reel.displayUrl}
          alt="Reel thumbnail"
          className="w-24 shrink-0 aspect-square object-cover bg-[#1A1410]"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div className="p-3 flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[#7A6A54] font-mono">{formatViews(reel.videoViewCount)} views</p>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
        </div>

        {analysis ? (
          <>
            {analysis.spokenHookVerbatim && (
              <p className="text-xs text-[#F5EDD6] mt-1.5 leading-snug">🎙 "{analysis.spokenHookVerbatim}"</p>
            )}
            {analysis.visualOpening && (
              <p className="text-xs text-[#C4A882] mt-1 leading-snug">{analysis.visualOpening}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20">
                {analysis.hookArchetype}
              </span>
              <span className="text-xs text-[#7A6A54] font-mono">hook {analysis.hookScore}/10</span>
            </div>
            <button onClick={() => setShowFull((f) => !f)} className="text-xs text-[#E07B3A] mt-2 hover:underline">
              {showFull ? 'Hide breakdown' : 'Show breakdown'}
            </button>
            {showFull && (
              <div className="mt-2 text-xs text-[#C4A882] space-y-1">
                <p><span className="text-[#7A6A54]">Hook:</span> {analysis.hookBreakdown}</p>
                <p><span className="text-[#7A6A54]">Pacing:</span> {analysis.pacingEditing}</p>
                <p><span className="text-[#7A6A54]">Audio:</span> {analysis.audioStrategy}</p>
                <p><span className="text-[#7A6A54]">Retention:</span> {analysis.retentionMechanism}</p>
                <p><span className="text-[#7A6A54]">Template:</span> {analysis.replicationTemplate}</p>
                <p><span className="text-[#A78BFA]">Replicate:</span> {analysis.whatToReplicate}</p>
                <p><span className="text-danger">Avoid:</span> {analysis.whatToAvoid}</p>
              </div>
            )}
          </>
        ) : status === 'failed' ? (
          <p className="text-xs text-danger mt-1.5">Couldn't analyze this reel.</p>
        ) : status === 'skipped' ? (
          <p className="text-xs text-[#7A6A54] mt-1.5">No downloadable video.</p>
        ) : (
          <p className="text-xs text-[#7A6A54] mt-1.5 italic">Watching the video…</p>
        )}
      </div>
    </div>
  )
}

// ----- Cross-profile niche report (Phase 2) -----

function ReportList({ title, items, titleClass }: { title: string; items: string[]; titleClass: string }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${titleClass}`}>{title}</h3>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="text-sm text-[#C4A882] leading-snug">{t}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The client-ready niche report: who's winning + the winning formula (Gemini synthesis),
 * the cross-creator archetype mix + comparison table + top exemplars (code-computed), and
 * actionable replicate/avoid/test/gaps. AI-synthesized copy uses the violet tint.
 *
 * Exported so the dedicated /report page can reuse the exact same rendering.
 */
export function DeepReportCard({ report }: { report: DeepNicheReport }) {
  return (
    <div className="mb-8 px-5 py-5 bg-[#1E1A2E] border border-[#A78BFA]/20 rounded-xl">
      <h2 className="text-lg font-semibold text-[#F5EDD6] mb-1">Niche report</h2>
      {report.whoIsWinning && <p className="text-sm text-[#C4A882] mb-3 leading-snug">{report.whoIsWinning}</p>}

      {report.nicheFormula && (
        <div className="mb-4 px-3 py-2 bg-[#13101E] rounded-lg">
          <p className="text-xs text-[#A78BFA] uppercase tracking-wide mb-1">Winning formula</p>
          <p className="text-sm text-[#F5EDD6] leading-snug">{report.nicheFormula}</p>
        </div>
      )}

      {report.archetypeDistribution.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {report.archetypeDistribution.slice(0, 6).map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#A78BFA]/10 border border-[#A78BFA]/20 text-sm text-[#A78BFA]">
              <span>{d.archetype}</span>
              <span className="text-[#A78BFA]/60 text-xs">×{d.count}</span>
            </div>
          ))}
        </div>
      )}

      {report.comparison.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#7A6A54] text-left">
                <th className="py-1 pr-3 font-medium">Creator</th>
                <th className="py-1 pr-3 font-medium">Reels</th>
                <th className="py-1 pr-3 font-medium">Avg hook</th>
                <th className="py-1 pr-3 font-medium">Median views</th>
                <th className="py-1 font-medium">Dominant</th>
              </tr>
            </thead>
            <tbody>
              {report.comparison.map((r) => (
                <tr key={r.handle} className="border-t border-[rgba(245,237,214,0.06)]">
                  <td className="py-1 pr-3 text-[#F5EDD6]">@{r.handle}</td>
                  <td className="py-1 pr-3 font-mono text-[#C4A882]">{r.reelCount}</td>
                  <td className="py-1 pr-3 font-mono text-[#C4A882]">{r.avgHookScore}</td>
                  <td className="py-1 pr-3 font-mono text-[#C4A882]">{formatViews(r.medianViews)}</td>
                  <td className="py-1 text-[#C4A882]">{r.dominantArchetype}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <ReportList title="Replicate" items={report.replicate} titleClass="text-[#A78BFA]" />
        <ReportList title="Avoid" items={report.avoid} titleClass="text-danger" />
        <ReportList title="Test" items={report.test} titleClass="text-[#E07B3A]" />
        <ReportList title="Gaps / opportunities" items={report.gaps} titleClass="text-[#C4A882]" />
      </div>

      {/* Export — the client-ready deliverable. */}
      <div className="flex gap-2 mt-5">
        <button
          onClick={() => void copyToClipboard(formatDeepReportMarkdown(report, report.comparison.map((c) => c.handle)))}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-[#A78BFA]/15 text-[#C4B5FD] border border-[#A78BFA]/30 hover:bg-[#A78BFA]/25 transition-colors"
        >
          Copy report (markdown)
        </button>
        <button
          onClick={() => downloadMarkdown(formatDeepReportMarkdown(report, report.comparison.map((c) => c.handle)), 'niche-report.md')}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-[#2C2218] text-[#C4A882] border border-[rgba(245,237,214,0.12)] hover:border-[#E07B3A]/40 transition-colors"
        >
          Download .md
        </button>
      </div>
    </div>
  )
}
