/**
 * Location discovery pipeline — city + niche → candidate creator profiles.
 *
 * Pipeline:
 *   Step 1: Scrape posts from location-aware hashtags → extract creator handles
 *   Step 2: Scrape full profiles for all unique candidate handles (cap: 60)
 *   Step 3: Location filter → narrow to profiles with city signal in bio
 *
 * Uses shared Apify primitives from apifyCore.ts.
 * Runs hashtag scrapes in parallel with pLimit(3) to stay within timing budget:
 *   Standard (5 hashtags): ~2 batches × ~25s = ~50s + ~25s profiles = ~75s
 *   Deep    (8 hashtags):  ~3 batches × ~25s = ~75s + ~35s profiles = ~110s
 * Both fit within the 150s AbortController timeout.
 */

import pLimit from 'p-limit'
import { ACTORS, buildHashtagScraperInput, buildProfileScraperInput } from './actors'
import { normalizeProfiles, type ApifyProfileRaw, type NormalizedProfile } from './transformers'
import { startRun, pollRun, fetchDataset, chunk } from './apifyCore'
import { filterByLocation, type FilterResult } from './locationFilter'

const MAX_CONCURRENT = 3
const PROFILE_CAP = 60       // max handles to profile-scrape (controls Apify cost)
const POSTS_PER_HASHTAG: Record<'standard' | 'deep', number> = {
  standard: 20,
  deep: 25,
}

const limit = pLimit(MAX_CONCURRENT)

// ----- Raw types -----

interface HashtagPostRaw {
  ownerUsername?: string
}

// ----- Internal helpers -----

/**
 * Scrape posts from a single hashtag and return the list of post author usernames.
 */
async function scrapeHashtag(
  hashtag: string,
  postsLimit: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const input = buildHashtagScraperInput([hashtag], postsLimit)
  const { runId, datasetId } = await startRun(ACTORS.HASHTAG_SCRAPER, input, apiKey, signal)
  const resolvedDatasetId = await pollRun(runId, apiKey, signal)
  const posts = await fetchDataset<HashtagPostRaw>(resolvedDatasetId || datasetId, apiKey, signal)

  return posts
    .map((p) => p.ownerUsername?.trim().toLowerCase())
    .filter((u): u is string => Boolean(u))
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
 * Step 1: Scrape all hashtags in parallel (pLimit=3) → unique creator handles
 * Step 2: Profile-scrape the candidates (capped at PROFILE_CAP=60)
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

  console.log(`[discovery] Scraping ${hashtags.length} hashtags (${postsLimit} posts each)`)

  // Step 1: Scrape all hashtags in parallel, deduplicate handles across all results
  const hashtagResults = await Promise.all(
    hashtags.map((tag) =>
      limit(() => scrapeHashtag(tag, postsLimit, apiKey, signal))
    )
  )

  // Deduplicate across all hashtags → candidate handle pool
  const allHandles = hashtagResults.flat()
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
