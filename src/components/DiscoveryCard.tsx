/**
 * DiscoveryCard — richer profile card for the location discovery flow.
 *
 * Extends CompetitorCard with:
 *   - Location confidence badge (📍 Confirmed / Likely / Unknown)
 *   - Specialties chips (teal pills)
 *   - Content focus badge
 *   - Partnership ready icon
 *
 * The 3-tier location confidence visual treatment:
 *   confirmed → green filled badge
 *   likely    → amber outlined badge
 *   unknown   → grey muted, 70% opacity
 */

import { BadgeCheck, MapPin, Video, Mail, CheckSquare, History, Square } from 'lucide-react'
import type { DiscoveryResult } from '../ai/prompts'
import type { NormalizedProfile } from '../lib/transformers'
import { DISCOVERY_CATEGORIES } from '../shared/utils/categories'
import { useCorpusStore } from '../store/corpusStore'
import { recognition } from '../lib/corpus'
import { FeedbackControl } from './FeedbackControl'

interface DiscoveryCardProps {
  result: DiscoveryResult
  profile: NormalizedProfile | undefined
  cohortAvgER: number
  isSelected?: boolean
  onSelect?: (handle: string) => void
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function LocationBadge({ confidence }: { confidence: DiscoveryResult['locationConfidence'] }) {
  if (confidence === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[#1A2E1A] text-[#4DB88A] border border-[#2A4A2A]">
        <MapPin size={10} />
        Confirmed
      </span>
    )
  }
  if (confidence === 'likely') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-transparent text-[#C4862A] border border-[#C4862A]/60">
        <MapPin size={10} />
        Likely
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[#3D3025] text-[#7A6A54] opacity-70">
      <MapPin size={10} />
      Unconfirmed
    </span>
  )
}

export function DiscoveryCard({ result, profile, cohortAvgER, isSelected, onSelect }: DiscoveryCardProps) {
  const category = DISCOVERY_CATEGORIES[result.category]
  const er = profile?.engagementRate ?? null
  const erAboveAvg = er !== null && er >= cohortAvgER
  const initials = (profile?.fullName ?? result.username)
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  // Cross-search memory: if the corpus has seen this creator in a PRIOR search, surface it.
  const seen = recognition(useCorpusStore((s) => s.creators[result.username]))

  return (
    <div
      className={`bg-[#2C2218] rounded-xl p-4 relative transition-colors ${
        isSelected
          ? 'border-0 ring-2 ring-[#E07B3A] ring-offset-1 ring-offset-[#1A1410]'
          : 'border border-[rgba(245,237,214,0.08)] hover:border-[rgba(245,237,214,0.15)]'
      } ${onSelect ? 'cursor-pointer' : ''}`}
      onClick={onSelect ? () => onSelect(result.username) : undefined}
    >
      {/* Checkbox overlay — top left, only when onSelect is provided */}
      {onSelect && (
        <div className="absolute top-3 left-3">
          {isSelected ? (
            <CheckSquare size={18} className="text-[#E07B3A]" />
          ) : (
            <Square size={18} className="text-[#7A6A54]" />
          )}
        </div>
      )}

      {/* Category badge — top right */}
      <span
        className={`absolute top-4 right-4 text-xs font-semibold px-2 py-0.5 rounded-full ${category.badgeBg} ${category.badgeText}`}
      >
        {category.label} #{result.rank}
      </span>

      {/* Profile header */}
      <div className={`flex items-start gap-3 pr-20 ${onSelect ? 'pl-7' : ''}`}>
        {/* Avatar */}
        {profile?.profilePicUrl ? (
          <img
            src={profile.profilePicUrl}
            alt={`@${result.username}`}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0 bg-[#3D3025]"
            onError={(e) => {
              const target = e.currentTarget
              target.style.display = 'none'
              target.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        {/* Initials fallback */}
        <div
          className={`w-12 h-12 rounded-full bg-[#3D3025] flex items-center justify-center flex-shrink-0 text-[#C4A882] font-semibold text-sm ${
            profile?.profilePicUrl ? 'hidden' : ''
          }`}
        >
          {initials}
        </div>

        {/* Handle + meta */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-[#F5EDD6] text-sm">@{result.username}</span>
            {profile?.verified && (
              <BadgeCheck size={14} className="text-[#C4A882] flex-shrink-0" />
            )}
            <LocationBadge confidence={result.locationConfidence} />
            {seen && (
              <span
                title={seen.detail ? `Seen in ${seen.detail}` : undefined}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[rgba(224,123,58,0.12)] text-[#F4A97B] border border-[rgba(224,123,58,0.20)]"
              >
                <History size={10} />
                {seen.label}
              </span>
            )}
          </div>
          {profile?.fullName && profile.fullName !== result.username && (
            <p className="text-xs text-[#C4A882] mt-0.5 truncate">{profile.fullName}</p>
          )}
          {profile && (
            <p className="text-xs text-[#7A6A54] mt-0.5">
              {formatFollowers(profile.followersCount)} followers
            </p>
          )}
        </div>
      </div>

      {/* Engagement rate */}
      {er !== null && (
        <div className="mt-3 flex items-baseline gap-1.5">
          <span
            className={`text-xl font-bold tabular-nums ${
              erAboveAvg ? 'text-success' : 'text-warning'
            }`}
          >
            {er.toFixed(2)}%
          </span>
          <span className="text-xs text-[#7A6A54]">
            ER · {erAboveAvg ? 'above avg' : 'below avg'}
          </span>
        </div>
      )}

      {/* Specialties chips */}
      {result.specialties.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.specialties.map((s) => (
            <span
              key={s}
              className="text-xs px-2 py-0.5 rounded-full bg-[#1A2520] text-[#4DB894] border border-[#2A3D35]"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Content focus + partnership ready */}
      <div className="mt-2 flex items-center gap-3">
        {result.contentFocus && (
          <span className="inline-flex items-center gap-1 text-xs text-[#C4A882]">
            <Video size={11} className="text-[#7A6A54]" />
            {result.contentFocus}
          </span>
        )}
        {result.partnershipReady && (
          <span className="inline-flex items-center gap-1 text-xs text-[#E07B3A] font-medium">
            <Mail size={11} />
            Partnership ready
          </span>
        )}
      </div>

      {/* AI rationale */}
      <p className="mt-3 text-sm text-[#C4A882] leading-relaxed">
        {result.rationale}
      </p>

      {/* Feedback (Phase 3) — save/dismiss trains future rankings toward your taste. */}
      <div className="mt-3 pt-2 border-t border-[rgba(245,237,214,0.06)] flex items-center justify-between">
        <span className="text-[11px] text-[#7A6A54]">More like this?</span>
        <FeedbackControl username={result.username} />
      </div>
    </div>
  )
}
