/**
 * Scrape-blocked web fallback for competitor analysis.
 *
 * When Instagram blocks Apify (a timeout/hang, a rate-limit/quota error, or an empty login-wall
 * dataset), there is no scraped pool to rank. Rather than dead-ending the run, this module asks
 * Gemini — with Google Search grounding — to identify AND rank competitors DIRECTLY from web
 * knowledge, returning a complete top5/trending5 with a COARSE size band instead of real metrics
 * (which we cannot verify without a scrape).
 *
 * Honesty contract (see the fallback design):
 *   - Real handles only; the prompt forbids invented handles, the parser drops empty ones.
 *   - NO fabricated metrics. Stub profiles carry engagementRate: null and a band-derived follower
 *     ESTIMATE only — the UI renders these as unverified (`~est` / `—`) behind a "scraping blocked"
 *     banner, and the corpus never harvests them.
 *   - India + local geography is enforced in the prompt (INDIA_GEO_BLOCK), same as the normal path.
 *
 * The orchestrator NEVER throws — a failed/empty grounded call degrades to an empty result so the
 * caller can fall through to today's error message as a last resort.
 */

import { callGeminiGroundedJson } from '../ai/gemini'
import { buildWebFallbackPrompt, type WebFallbackSeed, type AnalysisOutput } from '../ai/prompts'
import type { NormalizedProfile } from './transformers'

export type SizeBand = 'ESTABLISHED' | 'LARGE' | 'MID' | 'RISING'
const SIZE_BANDS: readonly SizeBand[] = ['ESTABLISHED', 'LARGE', 'MID', 'RISING']

export interface WebFallbackCompetitor {
  /** Sanitized Instagram username (no @, lowercased). */
  handle: string
  /** Display name from the model — feeds the card title. */
  name: string
  category: 'top' | 'trending'
  rank: number
  rationale: string
  /** Coarse, unverified size estimate — we cannot scrape exact metrics under a block. */
  sizeBand: SizeBand
}

export interface WebFallbackParsed {
  niche: string
  summary: string
  competitors: WebFallbackCompetitor[]
}

/** Max competitors per tier — mirrors the normal pipeline's 5 Top / 5 Trending. */
const TIER_CAP = 5

/** IG-username sanitizer (matches knowledgeSeed.sanitizeHandle): strip @, lowercase, [a-z0-9._], cap 30. */
function sanitize(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30)
}

/** Newline-strip + length-clamp a free-text field (defends against a runaway grounded reply). */
function str(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.replace(/[\n\r]+/g, ' ').trim().slice(0, max) : ''
}

/** Normalize a size band; anything outside the known set degrades to MID (a safe mid estimate). */
function normBand(raw: unknown): SizeBand {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  return (SIZE_BANDS as readonly string[]).includes(s) ? (s as SizeBand) : 'MID'
}

/** Pull the competitor array out of a tolerant set of grounded-response shapes. */
function asCompetitorArray(raw: unknown): unknown[] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    for (const k of ['competitors', 'results', 'accounts']) {
      if (Array.isArray(o[k])) return o[k] as unknown[]
    }
  }
  return []
}

/**
 * Parse the grounded fallback reply (already JSON-parsed) into a clean, split competitor set.
 * Tolerant of shape drift; NEVER throws. Drops handle-less entries, dedups by handle, caps each
 * tier at 5, and re-ranks within tier (1..n) so model rank inconsistencies can't leak through.
 */
export function parseWebFallbackResult(raw: unknown): WebFallbackParsed {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const niche = str(obj.niche, 60)
  const summary = str(obj.summary, 400)

  const seen = new Set<string>()
  const top: WebFallbackCompetitor[] = []
  const trending: WebFallbackCompetitor[] = []

  for (const item of asCompetitorArray(raw)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const handle = sanitize(o.handle ?? o.username ?? o.account)
    if (!handle || seen.has(handle)) continue
    const category = String(o.category ?? '').trim().toLowerCase().startsWith('top') ? 'top' : 'trending'
    const bucket = category === 'top' ? top : trending
    if (bucket.length >= TIER_CAP) continue
    seen.add(handle)
    bucket.push({
      handle,
      name: str(o.name ?? o.fullName ?? o.displayName, 80),
      category,
      rank: bucket.length + 1,
      rationale: str(o.rationale ?? o.reason, 160),
      sizeBand: normBand(o.size_band ?? o.sizeBand ?? o.band),
    })
  }

  return { niche, summary, competitors: [...top, ...trending] }
}

/**
 * Representative follower count per size band. These are ESTIMATES used only for tiering/sorting and
 * a `~`-prefixed display — never presented as a verified metric. ESTABLISHED/LARGE land above the
 * 500K Top-tier line so the existing card tiering treats them as established; MID/RISING sit in the
 * Trending range.
 */
export function sizeBandToFollowers(band: SizeBand): number {
  switch (band) {
    case 'ESTABLISHED': return 1_200_000
    case 'LARGE': return 600_000
    case 'MID': return 150_000
    case 'RISING': return 45_000
  }
}

/**
 * Map web-named competitors to STUB NormalizedProfiles so the existing competitor cards can render
 * them. engagementRate is null (we did not scrape — no fabricated ER) and followersCount is a
 * band-derived estimate. The UI flags the whole result `unverified`, so these stubs are shown as
 * approximate, never as precise metrics.
 */
export function webFallbackToProfiles(competitors: WebFallbackCompetitor[]): NormalizedProfile[] {
  return competitors.map((c) => ({
    username: c.handle,
    fullName: c.name,
    biography: c.rationale,
    followersCount: sizeBandToFollowers(c.sizeBand),
    followsCount: 0,
    postsCount: 1,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 0,
    avgComments: 0,
    engagementRate: null,
    relatedHandles: [],
    topHashtags: [],
    discoverySource: 'knowledge',
  }))
}

export interface WebFallbackParams {
  /** Reference handles from the user's request (may be the only signal under a hard block). */
  handles: string[]
  /** Niche text (explicit or derived). '' triggers the research-the-handles path in the prompt. */
  niche: string
  /** Web-grounded niche briefing reused from the knowledge seed, if it ran before the block. */
  briefing?: string
  /** Handles the knowledge seed already named (unverified) — ranked + extended by the fallback. */
  seedCandidates?: WebFallbackSeed[]
  /** Reference profiles IF Round 1 scraped before the block — gives the prompt a local/region signal. */
  refProfiles?: NormalizedProfile[]
  mode?: 'precise' | 'broad'
}

/** Fresh empty result (new objects each call so a caller can never mutate a shared reference). */
function emptyResult(): { output: AnalysisOutput; profiles: NormalizedProfile[] } {
  return { output: { competitors: [], niche: '', summary: '' }, profiles: [] }
}

/**
 * Run the scrape-blocked web fallback: ONE grounded call → parse → map to the ranking output shape
 * + stub profiles. Returns competitors in AnalysisOutput form (handle → username) so it slots into
 * the existing setResults / snapshot path. NEVER throws — degrades to an empty result on any failure
 * or when the model names zero usable competitors.
 */
export async function webFallbackCompetitors(
  geminiKeys: string | string[],
  params: WebFallbackParams,
  signal?: AbortSignal,
): Promise<{ output: AnalysisOutput; profiles: NormalizedProfile[] }> {
  try {
    const prompt = buildWebFallbackPrompt(params.handles, params.niche, {
      briefing: params.briefing,
      seedCandidates: params.seedCandidates,
      refProfiles: params.refProfiles,
      mode: params.mode,
    })
    const raw = await callGeminiGroundedJson<unknown>(geminiKeys, prompt, { temperature: 0.4, maxOutputTokens: 4096, signal })
    const parsed = parseWebFallbackResult(raw)
    if (parsed.competitors.length === 0) return emptyResult()
    return {
      output: {
        competitors: parsed.competitors.map((c) => ({
          username: c.handle,
          category: c.category,
          rank: c.rank,
          rationale: c.rationale,
        })),
        niche: parsed.niche,
        summary: parsed.summary,
      },
      profiles: webFallbackToProfiles(parsed.competitors),
    }
  } catch {
    return emptyResult()
  }
}
