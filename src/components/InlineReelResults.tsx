import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { ProgressSteps } from './ProgressSteps'
import type { CreatorAnalysisState, ReelData, ReelAnalysis, SynthesisOutput } from '../store/reelAnalysisStore'

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
}

export function InlineReelResults({ handles, creatorStates, synthesisStatus, synthesis, synthesisError }: Props) {
  return (
    <div className="w-full mt-2">
      {synthesisStatus === 'running' && <SynthesisLoadingCard />}
      {synthesisStatus === 'done' && synthesis && <SynthesisCard synthesis={synthesis} />}
      {synthesisStatus === 'failed' && (
        <div className="mb-4 px-4 py-3 bg-[#2C1818] border border-red-900/40 rounded-xl text-sm text-red-400">
          Synthesis failed: {synthesisError ?? 'Unknown error'}
        </div>
      )}
      {handles.map(handle => {
        const state = creatorStates[handle]
        if (!state) return null
        return <CreatorSection key={handle} state={state} />
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

function SynthesisCard({ synthesis }: { synthesis: SynthesisOutput }) {
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
          <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">Avoid</h3>
          <ul className="space-y-2">
            {synthesis.avoidTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#C4A882]">
                <span className="text-red-500 mt-0.5">–</span>{tip}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function CreatorSection({ state }: { state: CreatorAnalysisState }) {
  const [expanded, setExpanded] = useState(false)

  const stepIndex = state.status === 'scraping' ? 1 : state.status === 'analyzing' ? 2 : 3

  if (state.status === 'failed') {
    return (
      <div className="mb-4 px-4 py-3 bg-[#2C1818] border border-red-900/40 rounded-xl text-sm text-red-400">
        @{state.handle} — analysis failed: {state.error ?? 'Unknown error'}. Check if the account is public.
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
          {state.reels.map(reel => (
            <ReelCard key={reel.shortCode} reel={reel} analysis={state.analyses[reel.shortCode]} />
          ))}
        </div>
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
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div className="p-3">
        <p className="text-xs text-[#7A6A54] font-mono">{formatViews(reel.videoViewCount)} views</p>
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
