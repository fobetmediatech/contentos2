/**
 * Location discovery pipeline — city + niche → candidate creator profiles.
 *
 * Pipeline:
 *   Step 1: Scrape posts from ALL location-aware hashtags in ONE actor run → creator handles
 *   Step 2: Scrape full profiles for all unique candidate handles (cap: 40)
 *   Step 3: Location filter → narrow to profiles with city signal in bio
 *
 * Uses shared Apify primitives from apifyCore.ts.
 *
 * Timing budget (each Apify run ≈ 25-35s including startup + poll):
 *   Standard (5 hashtags): 1 hashtag run ~30s + ~15s profiles (4 batches, 1 wave) = ~45s
 *   Deep    (8 hashtags):  1 hashtag run ~35s + ~20s profiles (4 batches, 2 waves) = ~55s
 *
 * Key design choice: ALL hashtags go into ONE actor run (not one run per hashtag).
 * Apify's hashtag scraper natively accepts an array — batching avoids paying the
 * per-run startup/cold-start overhead (5-15s) for each hashtag separately.
 */

import pLimit from 'p-limit'
import { ACTORS, buildHashtagScraperInput, buildProfileScraperInput } from './actors'
import { normalizeProfiles, type ApifyProfileRaw, type NormalizedProfile } from './transformers'
import { startRun, pollRun, fetchDataset, chunk } from './apifyCore'
import { filterByLocation, type FilterResult } from './locationFilter'

const MAX_CONCURRENT = 3
const PROFILE_CAP = 40       // max handles to profile-scrape (controls Apify cost + run time)
const POSTS_PER_HASHTAG: Record<'standard' | 'deep', number> = {
  standard: 20,
  deep: 25,
}

const limit = pLimit(MAX_CONCURRENT)

// ----- Raw types -----

interface HashtagPostRaw {
  ownerUsername?: string
}

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

// ----- Public API -----

export interface DiscoveryPipelineResult {
  candidateProfiles: NormalizedProfile[]
  filterResult: FilterResult
  /** The hashtags that were actually scraped */
  scrapedHashtags: string[]
}

/**
 * Run the full location discovery data pipeline.
 *
 * Step 1: Scrape all hashtags in ONE actor run → unique creator handles
 * Step 2: Profile-scrape the candidates in parallel batches (cap: PROFILE_CAP=40)
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
  // Apify's hashtag scraper accepts an array natively; there is no benefit to
  // firing one run per hashtag — it just multiplies cold-start overhead.
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
    }
  }

  // Cap at PROFILE_CAP to control Apify cost and run time
  const cappedHandles = uniqueHandles.slice(0, PROFILE_CAP)
  console.log(`[discovery] Profile-scraping ${cappedHandles.length} handles (cap: ${PROFILE_CAP})`)

  // Step 2: Scrape profiles in batches of 10, parallelized with pLimit
  const batches = chunk(cappedHandles, 10)
  const batchResults = await Promise.all(
    batches.map((batch) => limit(() => scrapeProfiles(batch, apiKey, signal)))
  )
  const candidateProfiles = batchResults.flat()
  console.log(`[discovery] Scraped ${candidateProfiles.length} profiles`)

  // Step 3: Location filter
  const filterResult = filterByLocation(candidateProfiles, city)

  return {
    candidateProfiles,
    filterResult,
    scrapedHashtags: hashtags,
  }
}
