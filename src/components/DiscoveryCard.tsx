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

import { memo } from 'react'
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
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface)] text-[var(--color-success)] border border-[var(--color-surface-raised)]">
        <MapPin size={10} />
        Confirmed
      </span>
    )
  }
  if (confidence === 'likely') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-transparent text-[var(--color-accent-hover)] border border-[rgba(var(--accent-rgb),0.60)]">
        <MapPin size={10} />
        Likely
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] opacity-70">
      <MapPin size={10} />
      Unconfirmed
    </span>
  )
}

export const DiscoveryCard = memo(function DiscoveryCard({ result, profile, cohortAvgER, isSelected, onSelect }: DiscoveryCardProps) {
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
  const record = useCorpusStore((s) => s.creators[result.username])
  const seen = recognition(record)
  // Dismissed creators visibly deprioritize (Phase 3) — dimmed, but hover restores so they
  // stay readable. Ranking-level deprioritization comes in slice 3.
  const dismissed = record?.feedback === 'dismissed'

  return (
    <div
      role={onSelect ? 'checkbox' : undefined}
      aria-checked={onSelect ? isSelected : undefined}
      tabIndex={onSelect ? 0 : undefined}
      className={`bg-[var(--color-surface)] rounded-xl p-4 relative transition-colors ${
        isSelected
          ? 'border-0 ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg)]'
          : 'border border-[rgba(var(--border-rgb),0.08)] hover:border-[rgba(var(--border-rgb),0.15)]'
      } ${onSelect ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]' : ''} ${dismissed ? 'opacity-60 hover:opacity-100' : ''}`}
      onClick={onSelect ? () => onSelect(result.username) : undefined}
      onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(result.username) } } : undefined}
    >
      {/* Checkbox overlay — top left, only when onSelect is provided */}
      {onSelect && (
        <div className="absolute top-3 left-3">
          {isSelected ? (
            <CheckSquare size={18} className="text-[var(--color-accent)]" />
          ) : (
            <Square size={18} className="text-[var(--color-text-muted)]" />
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
            className="w-12 h-12 rounded-full object-cover flex-shrink-0 bg-[var(--color-surface-raised)]"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget
              target.style.display = 'none'
              target.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        {/* Initials fallback */}
        <div
          className={`w-12 h-12 rounded-full bg-[var(--color-surface-raised)] flex items-center justify-center flex-shrink-0 text-[var(--color-text-secondary)] font-semibold text-sm ${
            profile?.profilePicUrl ? 'hidden' : ''
          }`}
        >
          {initials}
        </div>

        {/* Handle + meta */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <a
              href={`https://www.instagram.com/${result.username}/`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="font-semibold text-[var(--color-text-primary)] text-sm hover:text-[var(--color-accent)] hover:underline transition-colors"
            >@{result.username}</a>
            {profile?.verified && (
              <BadgeCheck size={14} className="text-[var(--color-text-secondary)] flex-shrink-0" />
            )}
            <LocationBadge confidence={result.locationConfidence} />
            {seen && (
              <span
                title={seen.detail ? `Seen in ${seen.detail}` : undefined}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[rgba(var(--accent-rgb),0.12)] text-[var(--color-accent-light)] border border-[rgba(var(--accent-rgb),0.20)]"
              >
                <History size={10} />
                {seen.label}
              </span>
            )}
          </div>
          {profile?.fullName && profile.fullName !== result.username && (
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">{profile.fullName}</p>
          )}
          {profile && (
            <p className="text-xs text-secondary mt-0.5">
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
          <span className="text-xs text-secondary">
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
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface)] text-[var(--color-success)] border border-[var(--color-surface-raised)]"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Content focus + partnership ready */}
      <div className="mt-2 flex items-center gap-3">
        {result.contentFocus && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
            <Video size={11} className="text-[var(--color-text-muted)]" />
            {result.contentFocus}
          </span>
        )}
        {result.partnershipReady && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] font-medium">
            <Mail size={11} />
            Partnership ready
          </span>
        )}
      </div>

      {/* AI rationale */}
      <p className="mt-3 text-sm text-[var(--color-text-secondary)] leading-relaxed">
        {result.rationale}
      </p>

      {/* Feedback (Phase 3) — save/dismiss trains future rankings toward your taste. */}
      <div className="mt-3 pt-2 border-t border-[rgba(var(--border-rgb),0.06)] flex items-center justify-between">
        <span className="text-[11px] text-[var(--color-text-muted)]">More like this?</span>
        <FeedbackControl username={result.username} />
      </div>
    </div>
  )
})
