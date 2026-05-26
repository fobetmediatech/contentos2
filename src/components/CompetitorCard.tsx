import { BadgeCheck } from 'lucide-react'
import type { CompetitorAnalysisResult } from '../ai/prompts'
import type { NormalizedProfile } from '../lib/transformers'
import { COMPETITOR_CATEGORIES } from '../shared/utils/categories'

interface CompetitorCardProps {
  competitor: CompetitorAnalysisResult
  profile: NormalizedProfile | undefined
  cohortAvgER: number
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function CompetitorCard({ competitor, profile, cohortAvgER }: CompetitorCardProps) {
  const category = COMPETITOR_CATEGORIES[competitor.category]
  const er = profile?.engagementRate ?? null
  const erAboveAvg = er !== null && er >= cohortAvgER
  const initials = (profile?.fullName ?? competitor.username)
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
        {category.label} #{competitor.rank}
      </span>

      {/* Profile header */}
      <div className="flex items-start gap-3 pr-20">
        {/* Avatar */}
        {profile?.profilePicUrl ? (
          <img
            src={profile.profilePicUrl}
            alt={`@${competitor.username}`}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0 bg-slate-100"
            onError={(e) => {
              // Fallback to initials on CDN expiry
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
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-900 text-sm">@{competitor.username}</span>
            {profile?.verified && (
              <BadgeCheck size={14} className="text-blue-500 flex-shrink-0" />
            )}
          </div>
          {profile?.fullName && profile.fullName !== competitor.username && (
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

      {/* AI rationale */}
      <p className="mt-3 text-sm text-slate-600 leading-relaxed">
        {competitor.rationale}
      </p>
    </div>
  )
}
