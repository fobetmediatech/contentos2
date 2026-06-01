/**
 * ReelAnalysisPage — orchestrates per-creator reel scraping + AI analysis,
 * then synthesizes cross-creator niche insights.
 *
 * URL: /reel-analysis?handles=handle1,handle2,...
 * Reads handles from query params, redirects to /discover/results if empty.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import pLimit from 'p-limit'
import { Info, ChevronDown, ChevronUp } from 'lucide-react'

import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { useKeysStore } from '../store/keysStore'
import { scrapeTopReels, NoReelsError } from '../lib/reelScraper'
import { analyzeReel, synthesizeNiche, buildPerCreatorSummary } from '../lib/reelAnalyzer'
import { ProgressSteps } from '../components/ProgressSteps'
import type { CreatorAnalysisState, ReelData, ReelAnalysis, SynthesisOutput } from '../store/reelAnalysisStore'

// p-limit(5): cap Gemini concurrency across all creators
const geminiLimiter = pLimit(5)

// ---------------------------------------------------------------------------
// Reel steps for ProgressSteps
// ---------------------------------------------------------------------------

const REEL_STEPS = ['Scraping reels', 'Analyzing hooks', 'Done']

// ---------------------------------------------------------------------------
// ReelAnalysisPage
// ---------------------------------------------------------------------------

export function ReelAnalysisPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const {
    creatorStates,
    synthesisStatus,
    synthesis,
    synthesisError,
    setCreatorState,
    setSynthesis,
    setSynthesisError,
    setSynthesisStatus,
    reset,
  } = useReelAnalysisStore()

  const { apifyKeys, geminiKey } = useKeysStore()

  const analysisStarted = useRef(false)
  const handlesRef = useRef<string[]>([])

  // Mount: reset store, read handles, redirect if empty, kick off analysis
  useEffect(() => {
    reset()
    const handlesParam = searchParams.get('handles') ?? ''
    const handles = handlesParam.split(',').map(h => h.trim()).filter(Boolean)

    if (handles.length === 0) {
      navigate('/discover/results', { replace: true })
      return
    }

    if (analysisStarted.current) return
    analysisStarted.current = true
    handlesRef.current = handles

    runAnalysis(handles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // empty deps — runs once on mount

  // ---------------------------------------------------------------------------
  // runAnalysis
  // ---------------------------------------------------------------------------

  async function runAnalysis(handles: string[]) {
    // Initialize all creators as 'scraping'
    handles.forEach(handle => {
      setCreatorState(handle, { handle, status: 'scraping', reels: [], analyses: {} })
    })

    // Run all creator pipelines in parallel
    // (Apify runs are serialized internally via reelScraper's own pLimit(1))
    await Promise.allSettled(handles.map(handle => runCreatorPipeline(handle)))
  }

  async function runCreatorPipeline(handle: string) {
    try {
      // 1. Scrape top 10 reels
      const reels = await scrapeTopReels(handle, 10, apifyKeys)
      setCreatorState(handle, { reels, status: 'analyzing' })

      // 2. Analyze each reel (geminiLimiter caps concurrency at 5)
      const analysisEntries = await Promise.all(
        reels.map(reel =>
          geminiLimiter(async () => {
            const analysis = await analyzeReel(reel, geminiKey)
            return [reel.shortCode, analysis] as const
          }),
        ),
      )

      const analyses = Object.fromEntries(analysisEntries)
      setCreatorState(handle, { analyses, status: 'done' })
    } catch (err) {
      if (err instanceof NoReelsError) {
        setCreatorState(handle, { status: 'no-reels', error: (err as Error).message })
      } else {
        setCreatorState(handle, { status: 'failed', error: (err as Error).message })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Synthesis trigger — fires once all creators reach a terminal state
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const states = Object.values(creatorStates)
    if (states.length === 0) return

    const TERMINAL = ['done', 'no-reels', 'failed'] as const
    const allTerminal = states.every(s => TERMINAL.includes(s.status as (typeof TERMINAL)[number]))
    if (!allTerminal) return
    if (synthesisStatus !== 'idle') return // already ran

    const doneSummaries = states
      .filter(s => s.status === 'done')
      .map(s => buildPerCreatorSummary(s.handle, s.analyses, s.reels))

    if (doneSummaries.length === 0) {
      setSynthesisError('All creators failed — no data to synthesize')
      return
    }

    setSynthesisStatus('running')
    synthesizeNiche(doneSummaries, geminiKey)
      .then(output => setSynthesis(output))
      .catch(err => setSynthesisError((err as Error).message))
  }, [creatorStates, synthesisStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Derive ordered handles (stable — from URL param parsed at mount)
  // ---------------------------------------------------------------------------

  const handlesParam = searchParams.get('handles') ?? ''
  const handles = handlesParam.split(',').map(h => h.trim()).filter(Boolean)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="pb-24">
      {/* Refresh warning banner */}
      <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-[#2C2218] border border-[rgba(245,237,214,0.08)] rounded-xl text-sm text-[#C4A882]">
        <Info size={14} className="text-[#7A6A54] mt-0.5 flex-shrink-0" />
        Refreshing will re-run analysis (~{handles.length * 2}–{handles.length * 3} min)
      </div>

      {/* Cross-creator synthesis card (hero) */}
      {synthesisStatus === 'running' && <SynthesisLoadingCard />}
      {synthesisStatus === 'done' && synthesis && <SynthesisCard synthesis={synthesis} />}
      {synthesisStatus === 'failed' && (
        <SynthesisErrorCard error={synthesisError ?? 'Synthesis failed'} />
      )}

      {/* Per-creator sections */}
      {handles.map(handle => {
        const state = creatorStates[handle]
        if (!state) return null
        return <CreatorSection key={handle} state={state} />
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SynthesisLoadingCard
// ---------------------------------------------------------------------------

function SynthesisLoadingCard() {
  return (
    <div className="mb-6 px-5 py-5 bg-[#1E1A2E] border border-[#A78BFA]/20 rounded-xl animate-pulse">
      <p className="text-sm text-[#A78BFA]">Synthesizing niche patterns…</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SynthesisErrorCard
// ---------------------------------------------------------------------------

function SynthesisErrorCard({ error }: { error: string }) {
  return (
    <div className="mb-6 px-5 py-4 bg-[#2C1818] border border-red-900/40 rounded-xl text-sm text-red-400">
      Synthesis failed: {error}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SynthesisCard
// ---------------------------------------------------------------------------

function SynthesisCard({ synthesis }: { synthesis: SynthesisOutput }) {
  return (
    <div className="mb-8 px-5 py-5 bg-[#1E1A2E] border border-[#A78BFA]/20 rounded-xl">
      {/* Header */}
      <h2 className="text-lg font-semibold text-[#F5EDD6] mb-4">
        Hook patterns dominating this niche
      </h2>

      {/* Pattern chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {synthesis.topPatterns.map((pattern, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#A78BFA]/10 border border-[#A78BFA]/20 text-sm text-[#A78BFA]"
          >
            <span>{pattern.archetype}</span>
            <span className="text-[#A78BFA]/60 text-xs">×{pattern.count}</span>
          </div>
        ))}
      </div>

      {/* Benchmarks */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="px-3 py-2 bg-[#13101E] rounded-lg">
          <p className="text-xs text-[#7A6A54] mb-0.5">Median views</p>
          <p className="text-sm font-mono text-[#C4A882]">
            {formatViews(synthesis.benchmarks.medianViews)}
          </p>
        </div>
        <div className="px-3 py-2 bg-[#13101E] rounded-lg">
          <p className="text-xs text-[#7A6A54] mb-0.5">Likes / views</p>
          <p className="text-sm font-mono text-[#C4A882]">
            {(synthesis.benchmarks.likesViewsRatio * 100).toFixed(1)}%
          </p>
        </div>
        <div className="px-3 py-2 bg-[#13101E] rounded-lg">
          <p className="text-xs text-[#7A6A54] mb-0.5">Comments / likes</p>
          <p className="text-sm font-mono text-[#C4A882]">
            {(synthesis.benchmarks.commentsLikesRatio * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Replicate / Avoid columns */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold text-[#A78BFA] uppercase tracking-wide mb-2">
            Replicate
          </h3>
          <ul className="space-y-2">
            {synthesis.replicateTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#C4A882]">
                <span className="text-[#A78BFA] mt-0.5">+</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
            Avoid
          </h3>
          <ul className="space-y-2">
            {synthesis.avoidTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#C4A882]">
                <span className="text-red-500 mt-0.5">–</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CreatorSection
// ---------------------------------------------------------------------------

function CreatorSection({ state }: { state: CreatorAnalysisState }) {
  const [expanded, setExpanded] = useState(false)

  const stepIndex =
    state.status === 'scraping'
      ? 1
      : state.status === 'analyzing'
        ? 2
        : 3 // done, no-reels, failed all map to step 3

  if (state.status === 'failed') {
    return (
      <div className="mb-4 px-4 py-3 bg-[#2C1818] border border-red-900/40 rounded-xl text-sm text-red-400">
        @{state.handle} — analysis failed: {state.error ?? 'Unknown error'}. Check if account is
        public.
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

  if (state.status === 'scraping' || state.status === 'analyzing') {
    return (
      <div className="mb-6">
        <h3 className="text-[#F5EDD6] font-medium mb-3">@{state.handle}</h3>
        <ProgressSteps currentStep={stepIndex} steps={REEL_STEPS} />
      </div>
    )
  }

  // done: collapsible reel card grid
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
        <div className="grid gap-3 grid-cols-2 xl:grid-cols-3">
          {state.reels.map(reel => {
            const analysis = state.analyses[reel.shortCode]
            return <ReelCard key={reel.shortCode} reel={reel} analysis={analysis} />
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReelCard
// ---------------------------------------------------------------------------

function ReelCard({ reel, analysis }: { reel: ReelData; analysis?: ReelAnalysis }) {
  const [showFull, setShowFull] = useState(false)

  return (
    <div className="bg-[#2C2218] border border-[rgba(245,237,214,0.08)] rounded-xl overflow-hidden">
      {/* Thumbnail */}
      {reel.displayUrl && (
        <img
          src={reel.displayUrl}
          alt="Reel thumbnail"
          className="w-full aspect-square object-cover bg-[#1A1410]"
          onError={e => {
            e.currentTarget.style.display = 'none'
          }}
        />
      )}
      <div className="p-3">
        {/* Views */}
        <p className="text-xs text-[#7A6A54] font-mono">{formatViews(reel.videoViewCount)} views</p>

        {/* Hook archetype chip */}
        {analysis && (
          <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20">
            {analysis.hookArchetype}
          </span>
        )}

        {/* Low confidence note */}
        {analysis?.lowConfidenceNote && (
          <p className="text-xs text-[#7A6A54] mt-1 italic">{analysis.lowConfidenceNote}</p>
        )}

        {/* Expand/collapse full analysis */}
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
            <p>
              <span className="text-[#7A6A54]">Retention:</span> {analysis.retentionMechanism}
            </p>
            <p>
              <span className="text-[#7A6A54]">Psychology:</span> {analysis.psychologyTrigger}
            </p>
            <p>
              <span className="text-[#7A6A54]">Template:</span> {analysis.replicationTemplate}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
