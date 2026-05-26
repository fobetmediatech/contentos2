/**
 * Location discovery pipeline — city + niche → candidate creator profiles.
 *
 * Pipeline:
 *   Step 1: Scrape posts from ALL location-aware hashtags in ONE actor run → creator handles
 *   Step 2: Scrape full profiles for all unique candidate handles (cap: 40)
 *   Step 2b: Creator enrichment — if fewer than MIN_CREATOR_THRESHOLD creators found,
 *            expand the pool using relatedHandles from existing creator profiles
 *   Step 3: Location filter → narrow to profiles with city signal in bio
 *
 * Uses shared Apify primitives from apifyCore.ts.
 *
 * Timing budget (each Apify run ≈ 25-35s including startup + poll):
 *   Standard (5 hashtags): 1 hashtag run ~30s + ~15s profiles (4 batches, 1 wave)
 *                          + optional ~10s expansion (2 batches) = ~45-55s
 *   Deep    (8 hashtags):  1 hashtag run ~35s + ~20s profiles (4 batches, 2 waves)
 *                          + optional ~10s expansion = ~55-65s
 *
 * Creator enrichment design:
 *   Instagram's "related profiles" for creator accounts are other creators in the same
 *   niche (audience overlap signal). Using creator-sourced relatedHandles as an expansion
 *   seed bypasses the hashtag→business-dominance problem.
 *
 *   Signal priority in expansion:
 *     1. relatedHandles from creator profiles (highest signal — creator graph)
 *     2. relatedHandles from business profiles (fallback — if creator pool is very sparse)
 *
 *   Creator scoring (isCreatorLikely): additive signals only, not a hard gate.
 *     - isBusinessAccount: false  (primary — from Apify)
 *     - follower/following ratio > 3:1  (secondary — asymmetric audience)
 *     - bio keywords: collab/vlogger/blogger/creator/foodie/reviewer  (tertiary)
 *   A profile must match at least one signal to count as a "creator".
 *
 * Security: relatedHandles come from Apify API responses (user-controlled data).
 * All handles are validated with HANDLE_PATTERN before being passed to scrapeProfiles.
 */

import pLimit from 'p-limit'
import { ACTORS, buildHashtagScraperInput, buildProfileScraperInput } from './actors'
import { normalizeProfiles, type ApifyProfileRaw, type NormalizedProfile } from './transformers'
import { startRun, pollRun, fetchDataset, chunk } from './apifyCore'
import { filterByLocation, type FilterResult } from './locationFilter'

// ----- Concurrency + caps -----

const MAX_CONCURRENT = 3
/** Max handles to profile-scrape from hashtag results (controls Apify cost + run time) */
const PROFILE_CAP = 40
const POSTS_PER_HASHTAG: Record<'standard' | 'deep', number> = {
  standard: 20,
  deep: 25,
}

const limit = pLimit(MAX_CONCURRENT)

// ----- Creator enrichment constants -----

/** If fewer than this many creator accounts exist in the initial pool, trigger expansion */
const MIN_CREATOR_THRESHOLD = 8
/** Max additional handles to scrape in one expansion round */
const EXPANSION_CAP = 20
/** Max creator profiles in the final candidate set passed to Gemini */
const MAX_CREATORS = 15
/** Max business profiles in the final candidate set passed to Gemini */
const MAX_BUSINESSES = 10

// ----- Security: handle validation -----

/**
 * Valid Instagram handle pattern: alphanumeric, underscore, period. Max 30 chars.
 * Rejects crafted handles like "../admin" or "user?q=x" from adversarial API responses.
 */
const HANDLE_PATTERN = /^[\w.]{1,30}$/

function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle)
}

// ----- Creator scoring (additive signals) -----

/**
 * Bio keyword patterns that strongly signal content creator accounts.
 * Intentionally generous: matches partial words (e.g. "vlogging" matches "vlog").
 * This is an ADDITIVE signal — a false positive here is fine (it adds a creator,
 * doesn't remove one). Kept intentionally English-only; missing non-English creators
 * is acceptable given this is a tertiary tiebreaker, not a gate.
 */
const CREATOR_BIO_PATTERN = /collab|vlogger|vlog|blogger|blog|content creator|creator|foodie|reviewer|review|influencer/i

/**
 * Score a profile as creator-like using three additive signals.
 * Returns true if ANY signal fires (not a hard gate — avoids excluding
 * micro-influencers with low follower ratios or non-English bios).
 */
function isCreatorLikely(profile: NormalizedProfile): boolean {
  // Signal 1: Apify's isBusinessAccount field (primary, most reliable)
  if (!profile.isBusinessAccount) return true

  // Signal 2: Follower/following asymmetry (creators have many followers, few following)
  // Guard: followsCount === 0 → Infinity > 3 → true (no-following accounts are creator-like)
  const ratio = profile.followsCount === 0
    ? Infinity
    : profile.followersCount / profile.followsCount
  if (ratio > 3) return true

  // Signal 3: Bio keyword match
  if (CREATOR_BIO_PATTERN.test(profile.biography)) return true

  return false
}

// ----- Raw types -----

interface HashtagPostRaw {
  ownerUsername?: string
}

// ----- Profile scraping helper -----

/**
 * Scrape full profiles for a batch of handles.
 */
async function scrapeProfiles(
  handles: string[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<NormalizedProfile[]> {
  if (handles.length === 0) return []
  const input = buildProfileScraperInput(handles)
  const { runId, datasetId } = await startRun(ACTORS.PROFILE_SCRAPER, input, apiKey, signal)
  const resolvedDatasetId = await pollRun(runId, apiKey, signal)
  const raw = await fetchDataset<ApifyProfileRaw>(resolvedDatasetId || datasetId, apiKey, signal)
  return normalizeProfiles(raw)
}

// ----- Creator enrichment -----

/**
 * Collect related handles from profiles to use as expansion seeds.
 * Priority: creator profiles first (higher signal), then business profiles as fallback.
 * Stops collecting once EXPANSION_CAP handles are found (early exit to avoid large arrays).
 *
 * Security: all handles are validated with HANDLE_PATTERN before being returned.
 */
function collectExpansionHandles(
  creatorProfiles: NormalizedProfile[],
  businessProfiles: NormalizedProfile[],
  alreadyScraped: Set<string>,
): string[] {
  const candidates = new Set<string>()

  // Collect from creators first (high signal: Instagram clusters creator→creator)
  for (const profile of creatorProfiles) {
    for (const handle of profile.relatedHandles) {
      if (candidates.size >= EXPANSION_CAP) break
      const normalized = handle.toLowerCase().trim()
      if (normalized && isValidHandle(normalized) && !alreadyScraped.has(normalized)) {
        candidates.add(normalized)
      }
    }
    if (candidates.size >= EXPANSION_CAP) break
  }

  // Fall back to business profiles' related handles if still not enough
  if (candidates.size < EXPANSION_CAP) {
    for (const profile of businessProfiles) {
      for (const handle of profile.relatedHandles) {
        if (candidates.size >= EXPANSION_CAP) break
        const normalized = handle.toLowerCase().trim()
        if (normalized && isValidHandle(normalized) && !alreadyScraped.has(normalized)) {
          candidates.add(normalized)
        }
      }
      if (candidates.size >= EXPANSION_CAP) break
    }
  }

  return [...candidates]
}

/**
 * Enrich the candidate pool with additional creator profiles.
 *
 * Triggered when the initial profile scrape yields fewer than MIN_CREATOR_THRESHOLD
 * creator accounts. Uses relatedHandles from existing profiles as expansion seeds,
 * prioritizing creator-sourced handles (higher signal quality).
 *
 * Returns the enriched pool: up to MAX_CREATORS creators + MAX_BUSINESSES businesses.
 */
async function enrichCreatorPool(
  initialProfiles: NormalizedProfile[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ enrichedCandidates: NormalizedProfile[]; creatorCount: number; businessCount: number }> {
  // Split initial pool by creator likelihood
  const creatorProfiles = initialProfiles.filter(isCreatorLikely)
  const businessProfiles = initialProfiles.filter((p) => !isCreatorLikely(p))

  console.log(
    `[discovery] Pool split: ${creatorProfiles.length} creators, ${businessProfiles.length} businesses (threshold: ${MIN_CREATOR_THRESHOLD})`,
  )

  // If we already have enough creators, skip expansion
  if (creatorProfiles.length >= MIN_CREATOR_THRESHOLD) {
    const enrichedCandidates = [
      ...creatorProfiles.slice(0, MAX_CREATORS),
      ...businessProfiles.slice(0, MAX_BUSINESSES),
    ]
    return {
      enrichedCandidates,
      creatorCount: Math.min(creatorProfiles.length, MAX_CREATORS),
      businessCount: Math.min(businessProfiles.length, MAX_BUSINESSES),
    }
  }

  // Expansion: use relatedHandles from creator profiles (creator-first, then business fallback)
  const alreadyScraped = new Set(initialProfiles.map((p) => p.username.toLowerCase()))
  const expansionHandles = collectExpansionHandles(creatorProfiles, businessProfiles, alreadyScraped)

  console.log(
    `[discovery] Creator enrichment: expanding with ${expansionHandles.length} related handles`,
  )

  let expansionCreators: NormalizedProfile[] = []
  let expansionBusinesses: NormalizedProfile[] = []

  if (expansionHandles.length > 0) {
    try {
      const expansionBatches = chunk(expansionHandles, 10)
      const expansionResults = await Promise.all(
        expansionBatches.map((batch) => limit(() => scrapeProfiles(batch, apiKey, signal))),
      )
      const expansionProfiles = expansionResults.flat()
      expansionCreators = expansionProfiles.filter(isCreatorLikely)
      expansionBusinesses = expansionProfiles.filter((p) => !isCreatorLikely(p))
      console.log(
        `[discovery] Expansion yielded: ${expansionCreators.length} new creators, ${expansionBusinesses.length} new businesses`,
      )
    } catch (err) {
      // Expansion is best-effort — if it fails, proceed with original pool
      console.warn('[discovery] Creator expansion failed, proceeding with original pool:', err)
    }
  } else {
    console.log('[discovery] No expansion handles available — proceeding with original pool')
  }

  // Assemble final candidate set: creators get priority
  const allCreators = [...creatorProfiles, ...expansionCreators]
  const allBusinesses = [...businessProfiles, ...expansionBusinesses]

  const finalCreators = allCreators.slice(0, MAX_CREATORS)
  const finalBusinesses = allBusinesses.slice(0, MAX_BUSINESSES)

  console.log(
    `[discovery] Final pool: ${finalCreators.length} creators + ${finalBusinesses.length} businesses`,
  )

  return {
    enrichedCandidates: [...finalCreators, ...finalBusinesses],
    creatorCount: finalCreators.length,
    businessCount: finalBusinesses.length,
  }
}

// ----- Public API -----

export interface DiscoveryPipelineResult {
  candidateProfiles: NormalizedProfile[]
  filterResult: FilterResult
  /** The hashtags that were actually scraped */
  scrapedHashtags: string[]
  /** Number of creator profiles (isCreatorLikely) in the final candidate set */
  creatorCount: number
  /** Number of business profiles in the final candidate set */
  businessCount: number
}

/**
 * Run the full location discovery data pipeline.
 *
 * Step 1: Scrape all hashtags in ONE actor run → unique creator handles
 * Step 2: Profile-scrape the candidates in parallel batches (cap: PROFILE_CAP=40)
 * Step 2b: Creator enrichment — if <MIN_CREATOR_THRESHOLD creators found, expand via relatedHandles
 * Step 3: Apply location filter → FilterResult (may be relaxed)
 *
 * @param hashtags   Location-aware hashtags from hashtagGenerator.ts
 * @param city       Target city for location filter
 * @param apiKey     Active Apify API key
 * @param depth      Controls posts-per-hashtag scrape depth
 * @param signal     AbortController signal for 150s timeout
 */
export async function runLocationDiscovery(
  hashtags: string[],
  city: string,
  apiKey: string,
  depth: 'standard' | 'deep' = 'standard',
  signal?: AbortSignal,
): Promise<DiscoveryPipelineResult> {
  const postsLimit = POSTS_PER_HASHTAG[depth]

  console.log(`[discovery] Scraping ${hashtags.length} hashtags in one run (${postsLimit} posts each)`)

  // Step 1: ALL hashtags in ONE actor run → pay startup cost once, not N times.
  const hashtagInput = buildHashtagScraperInput(hashtags, postsLimit)
  const { runId: hRunId, datasetId: hDatasetId } = await startRun(ACTORS.HASHTAG_SCRAPER, hashtagInput, apiKey, signal)
  const hResolved = await pollRun(hRunId, apiKey, signal)
  const posts = await fetchDataset<HashtagPostRaw>(hResolved || hDatasetId, apiKey, signal)

  const allHandles = posts
    .map((p) => p.ownerUsername?.trim().toLowerCase())
    .filter((u): u is string => Boolean(u))
  const uniqueHandles = [...new Set(allHandles)]
  console.log(`[discovery] ${uniqueHandles.length} unique handles from ${hashtags.length} hashtags`)

  if (uniqueHandles.length === 0) {
    return {
      candidateProfiles: [],
      filterResult: { filtered: [], relaxed: false, passedCount: 0 },
      scrapedHashtags: hashtags,
      creatorCount: 0,
      businessCount: 0,
    }
  }

  // Cap at PROFILE_CAP to control Apify cost and run time
  const cappedHandles = uniqueHandles.slice(0, PROFILE_CAP)
  console.log(`[discovery] Profile-scraping ${cappedHandles.length} handles (cap: ${PROFILE_CAP})`)

  // Step 2: Scrape profiles in batches of 10, parallelized with pLimit
  const batches = chunk(cappedHandles, 10)
  const batchResults = await Promise.all(
    batches.map((batch) => limit(() => scrapeProfiles(batch, apiKey, signal))),
  )
  const initialProfiles = batchResults.flat()
  console.log(`[discovery] Scraped ${initialProfiles.length} profiles`)

  // Step 2b: Creator enrichment — ensure the candidate pool has enough creators
  const { enrichedCandidates, creatorCount, businessCount } = await enrichCreatorPool(
    initialProfiles,
    apiKey,
    signal,
  )

  // Step 3: Location filter on the enriched candidate set
  const filterResult = filterByLocation(enrichedCandidates, city)

  return {
    candidateProfiles: enrichedCandidates,
    filterResult,
    scrapedHashtags: hashtags,
    creatorCount,
    businessCount,
  }
}
