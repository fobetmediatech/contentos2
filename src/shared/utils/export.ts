/**
 * Export utilities for the results page sticky bar.
 * UC2: Copy to Clipboard (formatted text) + Export CSV.
 */

import type { CompetitorAnalysisResult } from '../../ai/prompts'
import type { NormalizedProfile } from '../../lib/transformers'
import { COMPETITOR_CATEGORIES } from './categories'

interface ExportData {
  competitors: CompetitorAnalysisResult[]
  profiles: NormalizedProfile[]  // full profile data keyed by username
  sourceHandles: string[]
  clientName?: string
}

/**
 * Format results as plain text for clipboard ("Copy for Slides").
 * One competitor per block: rank, handle, ER, category, rationale.
 */
export function formatForClipboard(data: ExportData): string {
  const { competitors, profiles, sourceHandles } = data
  const profileMap = new Map(profiles.map((p) => [p.username, p]))

  const topItems = competitors.filter((c) => c.category === 'top').sort((a, b) => a.rank - b.rank)
  const trendingItems = competitors.filter((c) => c.category === 'trending').sort((a, b) => a.rank - b.rank)

  const formatItem = (c: CompetitorAnalysisResult, index: number): string => {
    const profile = profileMap.get(c.username)
    const er = profile?.engagementRate?.toFixed(2) ?? 'N/A'
    const followers = profile ? formatFollowers(profile.followersCount) : 'N/A'
    return [
      `${index + 1}. @${c.username}`,
      `   Followers: ${followers} | ER: ${er}%`,
      `   ${c.rationale}`,
    ].join('\n')
  }

  const lines: string[] = [
    `Instagram Competitor Analysis`,
    `Source accounts: ${sourceHandles.map((h) => '@' + h).join(', ')}`,
    '',
    `── ${COMPETITOR_CATEGORIES.top.sectionLabel} ──`,
    ...topItems.map((c, i) => formatItem(c, i)),
    '',
    `── ${COMPETITOR_CATEGORIES.trending.sectionLabel} ──`,
    ...trendingItems.map((c, i) => formatItem(c, i)),
  ]

  return lines.join('\n')
}

/**
 * Generate a CSV string for download.
 * Columns: rank, category, username, followers, er, verified, rationale, source_handles
 */
export function generateCSV(data: ExportData): string {
  const { competitors, profiles, sourceHandles } = data
  const profileMap = new Map(profiles.map((p) => [p.username, p]))

  const headers = ['rank', 'category', 'username', 'full_name', 'followers', 'engagement_rate', 'verified', 'rationale', 'source_handles']

  const rows = competitors
    .sort((a, b) => {
      // Top first, then trending; within each category sort by rank
      if (a.category !== b.category) return a.category === 'top' ? -1 : 1
      return a.rank - b.rank
    })
    .map((c) => {
      const profile = profileMap.get(c.username)
      return [
        c.rank,
        c.category,
        c.username,
        profile?.fullName ?? '',
        profile?.followersCount ?? '',
        profile?.engagementRate?.toFixed(2) ?? '',
        profile?.verified ? 'yes' : 'no',
        `"${c.rationale.replace(/"/g, '""')}"`,  // escape quotes in CSV
        sourceHandles.join(';'),
      ].join(',')
    })

  return [headers.join(','), ...rows].join('\n')
}

/**
 * Trigger a file download in the browser.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Copy text to clipboard with fallback for older browsers.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
  } else {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}
