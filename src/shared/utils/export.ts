/**
 * Export utilities for the results page sticky bar.
 * UC2: Copy to Clipboard (formatted text) + Export CSV.
 *
 * Contains two export sets:
 *   - Competitor analysis: formatForClipboard, generateCSV
 *   - Location discovery: formatDiscoveryForClipboard, generateDiscoveryCSV
 */

import type { CompetitorAnalysisResult, DiscoveryResult } from '../../ai/prompts'
import type { NormalizedProfile } from '../../lib/transformers'
import { COMPETITOR_CATEGORIES, DISCOVERY_CATEGORIES } from './categories'
import type { CreatorHookSummary } from '../../ai/prompts/creatorHookSummary'
import type { ReelResultPayload, RepurposeResultPayload } from '../../domain/chat'

/** Serialize a creator hook summary to portable Markdown (paste into Notion / Docs / email). */
export function summaryToMarkdown(summary: CreatorHookSummary): string {
  const n = (x: number) => Math.round(x).toLocaleString()
  const out: string[] = [`# @${summary.handle} — Reel Hook Report`, '', `_${summary.reelCount} reels analyzed_`]
  if (summary.narrative) out.push('', `> ${summary.narrative}`)
  out.push(
    '', '## Benchmarks',
    `- Median views: ${n(summary.benchmarks.medianViews)}`,
    `- Median likes: ${n(summary.benchmarks.medianLikes)}`,
    `- Comments/likes ratio: ${(summary.benchmarks.commentsLikesRatio * 100).toFixed(1)}%`,
  )
  if (summary.dominantHooks.length) {
    out.push('', '## Dominant hooks')
    for (const h of summary.dominantHooks) out.push(`- **${h.pattern}** (${h.count}×) — "${h.example}"`)
  }
  if (summary.whatConsistentlyWorks.length) {
    out.push('', '## What consistently works')
    for (const w of summary.whatConsistentlyWorks) out.push(`- ${w}`)
  }
  if (summary.recurringOpenings.length) {
    out.push('', '## Recurring openings')
    for (const o of summary.recurringOpenings) out.push(`- "${o}"`)
  }
  if (summary.replicableTemplates.length) {
    out.push('', '## Replicable templates')
    for (const t of summary.replicableTemplates) out.push(`- ${t}`)
  }
  return out.join('\n')
}

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
      // Text fields go through csvCell — formula-injection guard + quoting.
      // fullName/username are attacker-controlled (scraped profile data).
      return [
        c.rank,
        csvCell(c.category),
        csvCell(c.username),
        csvCell(profile?.fullName ?? ''),
        profile?.followersCount ?? '',
        profile?.engagementRate?.toFixed(2) ?? '',
        profile?.verified ? 'yes' : 'no',
        csvCell(c.rationale),
        csvCell(sourceHandles.join(';')),
      ].join(',')
    })

  return [headers.join(','), ...rows].join('\n')
}

/**
 * Trigger a text-file download in the browser (generic; CSV + markdown wrap this).
 */
export function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // Attach to DOM before clicking — required by Firefox for downloads to trigger
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Delay revoke so browser has time to initiate the download
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

export function downloadCSV(csv: string, filename: string): void {
  downloadTextFile(csv, filename, 'text/csv')
}

export function downloadMarkdown(md: string, filename: string): void {
  downloadTextFile(md, filename, 'text/markdown')
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

// ──────────────────────────────────────────────────────────
// Discovery export functions
// ──────────────────────────────────────────────────────────

interface DiscoveryExportData {
  results: DiscoveryResult[]
  profiles: NormalizedProfile[]
  city: string
  niche: string
  clientName?: string
}

interface DiscoveryCSVData extends DiscoveryExportData {
  sourceHashtags: string[]
}

/**
 * Format discovery results as plain text for clipboard ("Copy for Slides").
 */
export function formatDiscoveryForClipboard(data: DiscoveryExportData): string {
  const { results, profiles, city, niche, clientName } = data
  const profileMap = new Map(profiles.map((p) => [p.username, p]))

  const topItems = results.filter((r) => r.category === 'top').sort((a, b) => a.rank - b.rank)
  const trendingItems = results.filter((r) => r.category === 'trending').sort((a, b) => a.rank - b.rank)

  const formatItem = (r: DiscoveryResult, index: number): string => {
    const profile = profileMap.get(r.username)
    const er = profile?.engagementRate?.toFixed(2) ?? 'N/A'
    const followers = profile ? formatFollowers(profile.followersCount) : 'N/A'
    const locationIcon = r.locationConfidence === 'confirmed' ? '📍' : r.locationConfidence === 'likely' ? '📌' : '❓'
    return [
      `${index + 1}. @${r.username} ${locationIcon}`,
      `   Followers: ${followers} | ER: ${er}%`,
      `   Specialties: ${r.specialties.join(', ')}`,
      `   ${r.rationale}`,
    ].join('\n')
  }

  const lines: string[] = [
    `Location Discovery Report — ${city} ${niche}`,
    clientName ? `Client: ${clientName}` : '',
    '',
    `── ${DISCOVERY_CATEGORIES.top.sectionLabel} ──`,
    ...topItems.map((r, i) => formatItem(r, i)),
    '',
    `── ${DISCOVERY_CATEGORIES.trending.sectionLabel} ──`,
    ...trendingItems.map((r, i) => formatItem(r, i)),
  ].filter((l) => l !== undefined)

  return lines.join('\n')
}

/**
 * Generate a CSV string for discovery results download.
 * Columns: rank, category, username, followers, er_percent, verified,
 *          specialties, content_focus, partnership_ready, location_confidence,
 *          rationale, city, niche, source_hashtags
 */
function csvCell(value: string | number | boolean): string {
  const s = String(value)
  // Prefix formula-starting characters to prevent spreadsheet injection
  const safe = s.startsWith('=') || s.startsWith('+') || s.startsWith('-') || s.startsWith('@')
    ? `'${s}`
    : s
  return `"${safe.replace(/"/g, '""')}"`
}

// ──────────────────────────────────────────────────────────
// Google export payloads (Docs / Sheets)
//
// The client builds a NEUTRAL payload from a finished result and POSTs it to
// /api/google-export, which does only the Google-API plumbing. Sheets → tabular
// (competitor/discovery); Docs → the reel narrative report.
// ──────────────────────────────────────────────────────────

export type GoogleExportPayload =
  | { kind: 'sheet'; title: string; headers: string[]; rows: (string | number)[][] }
  | { kind: 'doc'; title: string; markdown: string }

/**
 * Formula-injection guard for Google Sheets cells. Sheets evaluates a cell that
 * starts with = + - or @ as a formula, so prefix those with an apostrophe — the
 * same protection csvCell gives CSV. Non-string values pass through untouched.
 */
function sheetCell(value: string | number): string | number {
  if (typeof value !== 'string') return value
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

/** Build a Google Sheet payload for competitor results (same columns as generateCSV). */
export function buildCompetitorSheet(data: ExportData): GoogleExportPayload {
  const { competitors, profiles, sourceHandles } = data
  const profileMap = new Map(profiles.map((p) => [p.username, p]))
  const headers = ['rank', 'category', 'username', 'full_name', 'followers', 'engagement_rate', 'verified', 'rationale', 'source_handles']

  const rows = [...competitors]
    .sort((a, b) => {
      if (a.category !== b.category) return a.category === 'top' ? -1 : 1
      return a.rank - b.rank
    })
    .map((c): (string | number)[] => {
      const profile = profileMap.get(c.username)
      return [
        c.rank,
        c.category,
        c.username,
        profile?.fullName ?? '',
        profile?.followersCount ?? '',
        profile?.engagementRate?.toFixed(2) ?? '',
        profile?.verified ? 'yes' : 'no',
        c.rationale,
        sourceHandles.join(';'),
      ].map(sheetCell)
    })

  const niche = data.clientName ? ` — ${data.clientName}` : ''
  return { kind: 'sheet', title: `Competitor Analysis${niche}`, headers, rows }
}

/** Build a Google Sheet payload for discovery results (same columns as generateDiscoveryCSV). */
export function buildDiscoverySheet(data: DiscoveryCSVData): GoogleExportPayload {
  const { results, profiles, city, niche, sourceHashtags } = data
  const profileMap = new Map(profiles.map((p) => [p.username, p]))
  const headers = [
    'rank', 'category', 'username', 'full_name', 'followers', 'engagement_rate',
    'verified', 'specialties', 'content_focus', 'partnership_ready',
    'location_confidence', 'rationale', 'city', 'niche', 'source_hashtags',
  ]

  const rows = [...results]
    .sort((a, b) => {
      if (a.category !== b.category) return a.category === 'top' ? -1 : 1
      return a.rank - b.rank
    })
    .map((r): (string | number)[] => {
      const profile = profileMap.get(r.username)
      return [
        r.rank,
        r.category,
        r.username,
        profile?.fullName ?? '',
        profile?.followersCount ?? '',
        profile?.engagementRate?.toFixed(2) ?? '',
        profile?.verified ? 'yes' : 'no',
        r.specialties.join(' | '),
        r.contentFocus,
        r.partnershipReady ? 'yes' : 'no',
        r.locationConfidence,
        r.rationale,
        city,
        niche,
        sourceHashtags.join(';'),
      ].map(sheetCell)
    })

  const label = [city, niche].filter(Boolean).join(' ')
  return { kind: 'sheet', title: `Location Discovery${label ? ` — ${label}` : ''}`, headers, rows }
}

/**
 * Build a Google Doc payload for a finished reel/hook run. Concatenates each
 * creator's HookMap summary (reusing summaryToMarkdown) plus a cross-creator
 * synthesis section when present.
 */
export function buildReelDoc(payload: ReelResultPayload): GoogleExportPayload {
  const { handles, creatorStates, synthesis } = payload
  const n = (x: number) => Math.round(x).toLocaleString()
  const out: string[] = [`# Reel Hook Report — ${handles.map((h) => `@${h}`).join(', ')}`, '']

  if (synthesis) {
    out.push('## Cross-creator synthesis', '')
    if (synthesis.topPatterns.length) {
      out.push('### Top patterns')
      for (const p of synthesis.topPatterns) out.push(`- **${p.archetype}** (${p.count}×) — "${p.example}"`)
      out.push('')
    }
    out.push(
      '### Benchmarks',
      `- Median views: ${n(synthesis.benchmarks.medianViews)}`,
      `- Likes/views ratio: ${(synthesis.benchmarks.likesViewsRatio * 100).toFixed(1)}%`,
      `- Comments/likes ratio: ${(synthesis.benchmarks.commentsLikesRatio * 100).toFixed(1)}%`,
      '',
    )
    if (synthesis.replicateTips.length) {
      out.push('### What to replicate')
      for (const t of synthesis.replicateTips) out.push(`- ${t}`)
      out.push('')
    }
    if (synthesis.avoidTips.length) {
      out.push('### What to avoid')
      for (const t of synthesis.avoidTips) out.push(`- ${t}`)
      out.push('')
    }
  }

  for (const handle of handles) {
    const state = creatorStates[handle]
    if (!state) continue
    if (state.hookSummary) {
      out.push('', summaryToMarkdown(state.hookSummary), '')
      continue
    }
    // Fallback when no creator-level summary exists: list the per-reel hooks so the doc is
    // never just a title.
    const reels = state.reels ?? []
    const analyzed = reels.filter((r) => state.analyses?.[r.shortCode])
    if (analyzed.length) {
      out.push('', `## @${handle}`, '')
      for (const r of analyzed) {
        const a = state.analyses[r.shortCode]
        out.push(`- **${a.hookArchetype}**${a.openingLine ? ` — "${a.openingLine}"` : ''} (${n(r.videoViewCount)} views)`)
      }
      out.push('')
    }
  }

  return { kind: 'doc', title: `Reel Hook Report — ${handles.map((h) => `@${h}`).join(', ')}`, markdown: out.join('\n') }
}

/** Build a Google Doc payload for a finished repurpose run (voice rewrite package). */
export function buildRepurposeDoc(payload: RepurposeResultPayload): GoogleExportPayload {
  const { voiceProfile: v, rewrite: r } = payload
  const displayHandle = v.handle.replace('__scripts__', 'pasted ')
  const out: string[] = [
    `# Repurposed script — @${displayHandle}'s voice`,
    '',
    `_${v.displayName || `@${displayHandle}`} · consistency ${v.personaConsistencyScore}/10${v.toneDescriptors.length ? ` · ${v.toneDescriptors.join(', ')}` : ''}_`,
    '',
    '## Spoken hook', r.spokenHook,
  ]
  if (r.altHooks.length) {
    out.push('', '## Alt hooks (A/B)')
    r.altHooks.forEach((h, i) => out.push(`${i + 1}. ${h}`))
  }
  if (r.beatScript.length) {
    out.push('', '## Beat-by-beat script')
    r.beatScript.forEach((b, i) => {
      out.push(`**${i + 1}. ${b.beatLabel || 'Beat'}** — ${b.script}`)
      if (b.onScreenText) out.push(`   _on-screen:_ ${b.onScreenText}`)
    })
  }
  out.push('', '## Caption', r.caption, '', '## CTA', r.cta)
  if (r.onScreenText.length) {
    out.push('', '## On-screen text')
    for (const t of r.onScreenText) out.push(`- ${t}`)
  }
  if (payload.sourceTranscript?.trim()) {
    out.push('', '## Source reel transcript', payload.sourceTranscript.trim())
  }
  return { kind: 'doc', title: `Repurposed script — @${displayHandle}`, markdown: out.join('\n') }
}

export function generateDiscoveryCSV(data: DiscoveryCSVData): string {
  const { results, profiles, city, niche, sourceHashtags } = data
  const profileMap = new Map(profiles.map((p) => [p.username, p]))

  const headers = [
    'rank', 'category', 'username', 'full_name', 'followers', 'engagement_rate',
    'verified', 'specialties', 'content_focus', 'partnership_ready',
    'location_confidence', 'rationale', 'city', 'niche', 'source_hashtags',
  ]

  const rows = results
    .sort((a, b) => {
      if (a.category !== b.category) return a.category === 'top' ? -1 : 1
      return a.rank - b.rank
    })
    .map((r) => {
      const profile = profileMap.get(r.username)
      return [
        r.rank,
        csvCell(r.category),
        csvCell(r.username),
        csvCell(profile?.fullName ?? ''),
        profile?.followersCount ?? '',
        profile?.engagementRate?.toFixed(2) ?? '',
        profile?.verified ? 'yes' : 'no',
        csvCell(r.specialties.join(' | ')),
        csvCell(r.contentFocus),
        r.partnershipReady ? 'yes' : 'no',
        csvCell(r.locationConfidence),
        csvCell(r.rationale),
        csvCell(city),
        csvCell(niche),
        csvCell(sourceHashtags.join(';')),
      ].join(',')
    })

  return [headers.join(','), ...rows].join('\n')
}
