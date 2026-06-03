/**
 * DiscoveryResultMessage — renders a completed location-discovery run INLINE in the chat
 * (Phase 2 stage 2), mirroring CompetitorResultMessage. Snapshotted into a `type:'result'`
 * message so it persists across reloads and interleaves with the conversation. No AI summary
 * (discovery doesn't produce one); adds the expand + location-relaxed notes.
 */

import { Bot, CheckCircle, Video, X } from 'lucide-react'
import type { DiscoveryResultPayload } from '../store/analysisStore'
import { DiscoveryCard } from './DiscoveryCard'
import { DISCOVERY_CATEGORIES } from '../shared/utils/categories'
import { MIN_LOCATION_RESULTS } from '../hooks/useLocationDiscovery'
import { deriveDiscoveryView } from './discoveryResultView'

interface Props {
  payload: DiscoveryResultPayload
  selectedHandles: string[]
  onToggleSelect: (handle: string) => void
  onClearSelection: () => void
  onAnalyzeReels: () => void
  onStartOver: () => void
  reelActive: boolean
}

export function DiscoveryResultMessage({
  payload,
  selectedHandles,
  onToggleSelect,
  onClearSelection,
  onAnalyzeReels,
  onStartOver,
  reelActive,
}: Props) {
  const { results, city, didExpand, locationRelaxed } = payload
  const { profileMap, cohortAvgER, top, trending } = deriveDiscoveryView(payload)

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
              <span className="font-semibold text-primary">Discovery complete</span>
            </div>
            <p className="text-secondary">
              Found {results.length} creator{results.length !== 1 ? 's' : ''}
              {city ? ` in ${city}` : ''}.
              Filtered for location signals and partnership readiness.
            </p>
            {didExpand && (
              <p className="text-xs text-warning mt-1.5">
                Expanded search with a second hashtag batch — initial pass found fewer than {MIN_LOCATION_RESULTS} creators in this city.
              </p>
            )}
            {locationRelaxed && (
              <p className="text-xs text-warning mt-1.5">
                Location filter relaxed — showing all niche-relevant creators; some may not be locally based.
              </p>
            )}
          </div>
          <button
            onClick={onStartOver}
            className="self-start px-4 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
          >
            Start over
          </button>
        </div>
      </div>

      {/* Card grids */}
      {top.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#7A6A54] uppercase tracking-wide mb-3">
            {DISCOVERY_CATEGORIES.top.sectionLabel}
          </p>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {top.map((r) => (
              <DiscoveryCard
                key={r.username}
                result={r}
                profile={profileMap.get(r.username)}
                cohortAvgER={cohortAvgER}
                isSelected={selectedHandles.includes(r.username)}
                onSelect={reelActive ? undefined : onToggleSelect}
              />
            ))}
          </div>
        </div>
      )}
      {trending.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#7A6A54] uppercase tracking-wide mb-3">
            {DISCOVERY_CATEGORIES.trending.sectionLabel}
          </p>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {trending.map((r) => (
              <DiscoveryCard
                key={r.username}
                result={r}
                profile={profileMap.get(r.username)}
                cohortAvgER={cohortAvgER}
                isSelected={selectedHandles.includes(r.username)}
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
