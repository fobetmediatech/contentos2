import { Sparkles } from 'lucide-react'
import type { CreatorHookSummary } from '../ai/prompts/creatorHookSummary'

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function HookSummaryCard({ summary }: { summary: CreatorHookSummary }) {
  const hasRecurringOpenings = summary.recurringOpenings.length > 0
  const hasWhatWorks = summary.whatConsistentlyWorks.length > 0
  const hasTemplates = summary.replicableTemplates.length > 0

  return (
    <div className="mb-6 px-5 py-5 bg-[#2C2218] border border-[rgba(245,237,214,0.12)] rounded-xl">
      {/* Header with AI marker */}
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={16} className="text-[#A78BFA]" />
        <h2 className="text-sm font-semibold text-[#F5EDD6]">Hook summary</h2>
        <span className="text-xs text-[#8B7D6B]">{summary.reelCount} reels</span>
      </div>

      {/* Benchmarks line */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="px-3 py-2 bg-[#1A1410] rounded-lg">
          <p className="text-xs text-[#8B7D6B] mb-0.5">Median views</p>
          <p className="text-sm font-mono text-[#C4A882] tabular-nums">{formatNumber(summary.benchmarks.medianViews)}</p>
        </div>
        <div className="px-3 py-2 bg-[#1A1410] rounded-lg">
          <p className="text-xs text-[#8B7D6B] mb-0.5">Median likes</p>
          <p className="text-sm font-mono text-[#C4A882] tabular-nums">{formatNumber(summary.benchmarks.medianLikes)}</p>
        </div>
        <div className="px-3 py-2 bg-[#1A1410] rounded-lg">
          <p className="text-xs text-[#8B7D6B] mb-0.5">Comments / likes</p>
          <p className="text-sm font-mono text-[#C4A882] tabular-nums">{(summary.benchmarks.commentsLikesRatio * 100).toFixed(1)}%</p>
        </div>
      </div>

      {/* Narrative paragraph */}
      {summary.narrative && (
        <p className="text-sm text-[#C4A882] mb-4 leading-snug">{summary.narrative}</p>
      )}

      {/* Dominant hooks list */}
      {summary.dominantHooks.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold font-mono uppercase tracking-wide text-[#E07B3A] mb-2">Dominant hooks</h3>
          <ul className="space-y-2">
            {summary.dominantHooks.map((hook, idx) => (
              <li key={idx} className="text-sm text-[#C4A882]">
                <span className="font-semibold text-[#F5EDD6]">{hook.pattern}</span>
                {' '}
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20 ml-1">×{hook.count}</span>
                {hook.example && (
                  <p className="text-xs text-[#8B7D6B] italic mt-0.5">"{hook.example}"</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What Consistently Works */}
      {hasWhatWorks && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold font-mono uppercase tracking-wide text-[#E07B3A] mb-2">What consistently works</h3>
          <ul className="space-y-1.5">
            {summary.whatConsistentlyWorks.map((item, idx) => (
              <li key={idx} className="text-sm text-[#C4A882] flex items-start gap-2">
                <span className="text-[#E07B3A] mt-0.5 flex-shrink-0">+</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recurring Openings */}
      {hasRecurringOpenings && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold font-mono uppercase tracking-wide text-[#E07B3A] mb-2">Recurring openings</h3>
          <ul className="space-y-1.5">
            {summary.recurringOpenings.map((opening, idx) => (
              <li key={idx} className="text-sm text-[#C4A882] flex items-start gap-2">
                <span className="text-[#E07B3A] mt-0.5 flex-shrink-0">+</span>
                <span>{opening}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Replicable Templates */}
      {hasTemplates && (
        <div>
          <h3 className="text-xs font-semibold font-mono uppercase tracking-wide text-[#A78BFA] mb-2">Replicate</h3>
          <ul className="space-y-1.5">
            {summary.replicableTemplates.map((template, idx) => (
              <li key={idx} className="text-sm text-[#C4A882] flex items-start gap-2">
                <span className="text-[#A78BFA] mt-0.5 flex-shrink-0">✓</span>
                <span>{template}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
