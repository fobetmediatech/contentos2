/**
 * Knowledge seed generator (Components A + B of the hybrid recall fix).
 *
 * The competitor pipeline's recall ceiling is that Gemini only RANKS a pre-scraped pool. This
 * module lets the LLM also GENERATE candidates: it NAMES real creators in a niche (web-grounded
 * for recency), and the caller scrape-verifies + identity-checks them before they enter the pool.
 *
 * Trust model (see CR-2 in docs/plans/hybrid-competitor-discovery.md):
 *   - The scrape proves a handle EXISTS, not that it is the RIGHT account.
 *   - matchesIntendedIdentity() is the identity gate that rejects likely wrong-person/namesquatter
 *     matches so a confidently-wrong account with real metrics never surfaces.
 *
 * The grounded call NEVER throws to the pipeline — generateNicheSeeds degrades to [] on any
 * failure so a seed problem can't abort the whole discovery run.
 */

import { callGeminiGroundedJson } from '../ai/gemini'
import { buildNicheSeedPrompt } from '../ai/prompts'
import type { NormalizedProfile } from './transformers'

/** How many handles to request from the model. */
export const SEED_REQUEST_COUNT = 24
/** Hard cap on handles we actually scrape-verify (CR-1 latency budget — ~2 batches). */
export const SEED_SCRAPE_CAP = 20
/** Hard cap on accounts pulled from the IG keyword-search source (Component C, CR-1 budget). */
export const SEARCH_RESULT_CAP = 20
/**
 * A scrape-verified, UNVERIFIED knowledge seed must clear this follower floor to be accepted on
 * size alone — a sizable account sitting at the exact handle the model named is almost certainly
 * the intended creator, not an impostor.
 */
export const IDENTITY_FOLLOWER_FLOOR = 10_000

export interface SeedCandidate {
  /** Sanitized Instagram username (no @, lowercased). */
  handle: string
  /** The model's intended display name — used by the identity gate to confirm the right account. */
  name: string
}

/** IG-username sanitizer: strip @, lowercase, keep [a-z0-9._] only, cap 30, drop empties. */
export function sanitizeHandle(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30)
}

/** Pull the candidate array out of a tolerant set of grounded-response shapes. */
function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const key of ['accounts', 'results', 'handles', 'creators']) {
      if (Array.isArray(o[key])) return o[key] as unknown[]
    }
  }
  return []
}

/**
 * Parse the grounded seed response (already JSON-parsed) into clean, deduped SeedCandidates.
 * Tolerant of shape drift: each item may be a bare string handle or an object carrying
 * handle/username + name/fullName. Invalid handles are dropped, duplicates collapsed. Never throws.
 */
export function parseSeedHandles(raw: unknown, cap = SEED_SCRAPE_CAP): SeedCandidate[] {
  const seen = new Set<string>()
  const out: SeedCandidate[] = []
  for (const item of asArray(raw)) {
    let handle = ''
    let name = ''
    if (typeof item === 'string') {
      handle = sanitizeHandle(item)
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      handle = sanitizeHandle(o.handle ?? o.username ?? o.account)
      const rawName = o.name ?? o.fullName ?? o.displayName
      name = typeof rawName === 'string' ? rawName.replace(/[\n\r]/g, ' ').slice(0, 80) : ''
    }
    if (!handle || seen.has(handle)) continue
    seen.add(handle)
    out.push({ handle, name })
    if (out.length >= cap) break
  }
  return out
}

/** Normalize a name/handle into comparable tokens (length ≥ 3, lowercased, alnum only). */
function nameTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 3)
}

/**
 * Identity gate for a scrape-verified knowledge seed (CR-2). The scrape proves the handle EXISTS;
 * this decides whether it is the account the model INTENDED. Accept only when one holds:
 *   - verified account (very unlikely to be a hijacked homonym for a named creator), OR
 *   - sizable account (>= IDENTITY_FOLLOWER_FLOOR) at the exact named handle, OR
 *   - the scraped fullName/username shares a meaningful token with the model's intended name.
 * With no name to match and a small unverified account, REJECT — that is the namesquatter risk.
 */
export function matchesIntendedIdentity(profile: NormalizedProfile, seed: SeedCandidate): boolean {
  if (profile.verified) return true
  if (profile.followersCount >= IDENTITY_FOLLOWER_FLOOR) return true
  const wanted = nameTokens(seed.name)
  if (wanted.length === 0) return false
  const have = new Set([...nameTokens(profile.fullName), ...nameTokens(profile.username)])
  return wanted.some((t) => have.has(t))
}

/**
 * Components A + B: name candidate creators in a niche, web-grounded for recency.
 * NEVER throws — degrades to [] on any failure so the discovery run is unaffected.
 * Returns SeedCandidates; the caller is responsible for scrape-verification + the identity gate.
 */
export async function generateNicheSeeds(
  geminiKeys: string | string[],
  niche: string,
  refProfiles: NormalizedProfile[],
  mode: 'precise' | 'broad',
  signal?: AbortSignal,
): Promise<SeedCandidate[]> {
  const trimmed = niche.trim()
  if (!trimmed) return []
  try {
    const prompt = buildNicheSeedPrompt(trimmed, refProfiles, SEED_REQUEST_COUNT, mode)
    const raw = await callGeminiGroundedJson<unknown>(geminiKeys, prompt, { temperature: 0.4, maxOutputTokens: 4096, signal })
    return parseSeedHandles(raw, SEED_SCRAPE_CAP)
  } catch {
    return []
  }
}
