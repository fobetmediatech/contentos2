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

import { BadgeCheck, MapPin, Video, Mail } from 'lucide-react'
import type { DiscoveryResult } from '../ai/prompts'
import type { NormalizedProfile } from '../lib/transformers'
import { DISCOVERY_CATEGORIES } from '../shared/utils/categories'

interface DiscoveryCardProps {
  result: DiscoveryResult
  profile: NormalizedProfile | undefined
  cohortAvgER: number
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function LocationBadge({ confidence }: { confidence: DiscoveryResult['locationConfidence'] }) {
  if (confidence === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
        <MapPin size={10} />
        Confirmed
      </span>
    )
  }
  if (confidence === 'likely') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border border-amber-400 text-amber-700">
        <MapPin size={10} />
        Likely
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 opacity-70">
      <MapPin size={10} />
      Unconfirmed
    </span>
  )
}

export function DiscoveryCard({ result, profile, cohortAvgER }: DiscoveryCardProps) {
  const category = DISCOVERY_CATEGORIES[result.category]
  const er = profile?.engagementRate ?? null
  const erAboveAvg = er !== null && er >= cohortAvgER
  const initials = (profile?.fullName ?? result.username)
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 relative hover:border-slate-300 transition-colors">
      {/* Category badge — top right */}
      <span
        className={`absolute top-4 right-4 text-xs font-semibold px-2 py-0.5 rounded-full ${category.badgeBg} ${category.badgeText}`}
      >
        {category.label} #{result.rank}
      </span>

      {/* Profile header */}
      <div className="flex items-start gap-3 pr-20">
        {/* Avatar */}
        {profile?.profilePicUrl ? (
          <img
            src={profile.profilePicUrl}
            alt={`@${result.username}`}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0 bg-slate-100"
            onError={(e) => {
              const target = e.currentTarget
              target.style.display = 'none'
              target.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        {/* Initials fallback */}
        <div
          className={`w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 text-slate-600 font-semibold text-sm ${
            profile?.profilePicUrl ? 'hidden' : ''
          }`}
        >
          {initials}
        </div>

        {/* Handle + meta */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-slate-900 text-sm">@{result.username}</span>
            {profile?.verified && (
              <BadgeCheck size={14} className="text-blue-500 flex-shrink-0" />
            )}
            <LocationBadge confidence={result.locationConfidence} />
          </div>
          {profile?.fullName && profile.fullName !== result.username && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{profile.fullName}</p>
          )}
          {profile && (
            <p className="text-xs text-slate-400 mt-0.5">
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
              erAboveAvg ? 'text-green-600' : 'text-amber-600'
            }`}
          >
            {er.toFixed(2)}%
          </span>
          <span className="text-xs text-slate-400">
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
              className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Content focus + partnership ready */}
      <div className="mt-2 flex items-center gap-3">
        {result.contentFocus && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Video size={11} className="text-slate-400" />
            {result.contentFocus}
          </span>
        )}
        {result.partnershipReady && (
          <span className="inline-flex items-center gap-1 text-xs text-indigo-600 font-medium">
            <Mail size={11} />
            Partnership ready
          </span>
        )}
      </div>

      {/* AI rationale */}
      <p className="mt-3 text-sm text-slate-600 leading-relaxed">
        {result.rationale}
      </p>
    </div>
  )
}
