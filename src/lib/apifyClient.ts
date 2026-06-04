/**
 * Apify REST API client — async run management with polling.
 *
 * Apify actor runs are ASYNC. POST /runs starts the run and returns a runId.
 * You must then poll GET /runs/{runId} until status === 'SUCCEEDED',
 * then fetch the dataset. This file handles the full lifecycle.
 *
 * Discovery pipeline (3 rounds + parallel hashtag expansion):
 *   Round 1:   Scrape input handles → extract relatedHandles + topHashtags
 *   Round 2:   Scrape relatedHandles → full competitor profiles
 *   Hashtag:   Scrape topHashtags (runs in PARALLEL with Round 2) → post authors
 *              → profile scrape those authors → content-niche candidates
 *   Round 3:   Scrape relatedHandles of Round 2 candidates → expand pool further
 *
 * The hashtag expansion is the key fix for pool contamination:
 *   - relatedProfiles is audience-adjacency (who watches the same content)
 *   - Hashtag posts are content-niche (who posts about the same topics)
 * Both signals are combined into the candidate pool before Gemini analysis.
 */

import pLimit from 'p-limit'
import { ACTORS, buildProfileScraperInput, buildHashtagScraperInput } from './actors'
import { normalizeProfiles, type ApifyProfileRaw, type NormalizedProfile } from './transformers'
import { startRun, pollRun, fetchDataset, chunk, withKeyFailover } from './apifyCore'

// Re-export shared error class so existing callers don't need to change their imports
export { ApifyError, type ApifyErrorCode } from './apifyCore'

const MAX_CONCURRENT = 3        // p-limit cap for concurrent actor runs

// Concurrency limiter — prevents firing too many actor runs simultaneously
const limit = pLimit(MAX_CONCURRENT)

// ----- Types -----

/** Raw post item from the Hashtag Scraper dataset */
interface HashtagPostRaw {
  ownerUsername?: string
  ownerId?: string
  productType?: string
}

// ----- High-level: scrape profiles -----

/**
 * Scrape a batch of Instagram handles and return normalized profiles.
 * Handles the full lifecycle: start → poll → fetch → normalize.
 */
async function scrapeHandles(
  handles: string[],
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<NormalizedProfile[]> {
  const input = buildProfileScraperInput(handles)
  // Per-run key failover: spreads across accounts AND rolls a tapped-out key (402) to a funded one.
  const raw = await withKeyFailover(apifyKeys, async (apiKey) => {
    const { runId, datasetId } = await startRun(ACTORS.PROFILE_SCRAPER, input, apiKey, signal)
    const resolvedDatasetId = await pollRun(runId, apiKey, signal)
    return fetchDataset<ApifyProfileRaw>(resolvedDatasetId || datasetId, apiKey, signal)
  })
  return normalizeProfiles(raw)
}

/**
 * Scrape recent posts for each hashtag and return unique usernames of post authors.
 *
 * This is the content-niche signal path:
 *   hashtags → posts → ownerUsername → unique handles
 *
 * Returns usernames only — caller is responsible for filtering against seenHandles
 * and then running a profile scrape batch on the resulting handles.
 *
 * @param hashtags     Top hashtags from reference profiles (plain strings, no #)
 * @param apifyKeys    All Apify keys; a fresh one is picked for this run
 * @param signal       AbortController signal
 * @param perHashtag   Max posts to fetch per hashtag (default: 20)
 */
export async function scrapeHashtagUsernames(
  hashtags: string[],
  apifyKeys: string[],
  signal?: AbortSignal,
  perHashtag = 20,
): Promise<string[]> {
  if (hashtags.length === 0) return []

  const top3 = hashtags.slice(0, 3)
  const input = buildHashtagScraperInput(top3, perHashtag)
  const posts = await withKeyFailover(apifyKeys, async (apiKey) => {
    const { runId, datasetId } = await startRun(ACTORS.HASHTAG_SCRAPER, input, apiKey, signal)
    const resolvedDatasetId = await pollRun(runId, apiKey, signal)
    return fetchDataset<HashtagPostRaw>(resolvedDatasetId || datasetId, apiKey, signal)
  })

  // Extract ownerUsername from each post, drop missing/empty values
  const usernames = posts
    .map((p) => p.ownerUsername?.trim().toLowerCase())
    .filter((u): u is string => Boolean(u))

  // Deduplicate
  return [...new Set(usernames)]
}

// ----- Public API: 2-round competitor discovery -----

export interface ScrapeResult {
  inputProfiles: NormalizedProfile[]
  candidateProfiles: NormalizedProfile[]
}

// Round 3 pool-expansion caps. Standard always runs Round 3 now — the depth gate
// was removed because the timing fits comfortably within the 120s budget even on
// standard runs (~15s Round 1 + ~25s Round 2 + ~15s Round 3 + ~8s Gemini ≈ 63s).
// Increasing the cap is how you get more candidates; standard=10 targets ≥15 total
// candidates so Gemini has enough pool to return a full 10 competitors after filtering.
const ROUND3_CAP: Record<'standard' | 'deep', number> = {
  standard: 10,
  deep: 20,
}

/**
 * Full discovery pipeline: Round 1 → Round 2 + Hashtag (parallel) → Round 3.
 *
 * Round 1: Scrape input handles → profiles + relatedHandles + topHashtags
 * Round 2: Scrape relatedHandles (audience-adjacency signal)     ┐ parallel
 * Hashtag: Scrape post authors from topHashtags (content-niche)  ┘
 *          → profile scrape those authors → content-niche candidates
 * Round 3: Scrape relatedHandles of Round 2 candidates → expand pool
 *          Always runs. Cap = 10 (standard) or 20 (deep).
 *
 * The parallel hashtag expansion fixes pool contamination:
 *   relatedProfiles = who watches same content (audience-adjacency)
 *   Hashtag posts  = who posts about same topics (content-niche)
 * Combining both signals gives Gemini a better, more niche-relevant pool.
 *
 * @param inputHandles  1–5 reference Instagram handles
 * @param apifyKeys     All Apify keys; each scrape RUN picks a fresh one (load-spreading)
 * @param signal        AbortController signal for 120s timeout
 * @param depth         Controls Round 3 cap: 'standard' = 10, 'deep' = 20
 */
export async function discoverCompetitors(
  inputHandles: string[],
  apifyKeys: string[],
  signal?: AbortSignal,
  depth: 'standard' | 'deep' = 'standard',
): Promise<ScrapeResult> {
  // Round 1: scrape input handles → get profiles, relatedHandles, topHashtags
  const inputProfiles = await scrapeHandles(inputHandles, apifyKeys, signal)

  // Build seen set to avoid re-scraping any handle
  const seenHandles = new Set(inputHandles.map((h) => h.replace(/^@/, '').toLowerCase()))

  // Extract candidate handles from Round 1 relatedProfiles
  const allRelated = inputProfiles.flatMap((p) => p.relatedHandles)
  const candidateHandles = [...new Set(allRelated)]
    .filter((h) => !seenHandles.has(h.toLowerCase()))

  if (candidateHandles.length === 0) {
    return { inputProfiles, candidateProfiles: [] }
  }

  // Extract top hashtags from input profiles for content-niche expansion
  const allHashtags = inputProfiles.flatMap((p) => p.topHashtags)
  const uniqueHashtags = [...new Set(allHashtags)]

  // Round 2 + Hashtag expansion: run in PARALLEL
  // Round 2 uses audience-adjacency signal (relatedProfiles)
  // Hashtag uses content-niche signal (who actually posts about these topics)
  const round2Batches = chunk(candidateHandles, 10)
  const [round2Results, hashtagUsernames] = await Promise.all([
    // Round 2: scrape relatedProfile candidates
    Promise.all(
      round2Batches.map((batch) => limit(() => scrapeHandles(batch, apifyKeys, signal))),
    ),
    // Hashtag expansion: post authors from top-3 hashtags (guard: empty → [])
    uniqueHashtags.length > 0
      ? scrapeHashtagUsernames(uniqueHashtags, apifyKeys, signal)
      : Promise.resolve([] as string[]),
  ])

  // Tag Round 2 profiles as audience-adjacency signal (relatedProfiles)
  const round2Profiles = round2Results.flat().map((p) => ({ ...p, discoverySource: 'relatedProfiles' as const }))
  candidateHandles.forEach((h) => seenHandles.add(h.toLowerCase()))

  // Compute hashtag handles first (filtered against round1+round2 seen set).
  // Cap at 20 (2 batches) — beyond this the timing cost exceeds the pool quality gain.
  const hashtagHandles = hashtagUsernames
    .filter((h) => !seenHandles.has(h))
    .slice(0, 20)

  console.log(`[hashtag] ${hashtagHandles.length} net-new handles from content-niche expansion (${uniqueHashtags.slice(0, 3).join(', ')})`)

  // Add hashtag handles to seen BEFORE computing Round 3 — prevents overlap between
  // the two parallel scrapes, keeping the combined pool clean.
  hashtagHandles.forEach((h) => seenHandles.add(h))

  // Compute Round 3 handles (now filtered against round1+round2+hashtag seen set).
  const round3Cap = ROUND3_CAP[depth]
  const round3Related = round2Profiles.flatMap((p) => p.relatedHandles)
  const round3Handles = [...new Set(round3Related)]
    .filter((h) => !seenHandles.has(h.toLowerCase()))
    .slice(0, round3Cap)

  console.log(`[round3] ${round3Handles.length} net-new handles (cap: ${round3Cap}, seen: ${seenHandles.size})`)

  // Hashtag profile scrape + Round 3 run IN PARALLEL.
  // Both only need data already available (round2Profiles and hashtagHandles),
  // so there is no dependency between them. Sequential cost was ~50s; parallel = ~25s.
  const [hashtagProfiles, round3Profiles] = await Promise.all([
    // Hashtag path: profile-scrape the content-niche handles
    (async (): Promise<NormalizedProfile[]> => {
      if (hashtagHandles.length === 0) {
        console.log('[hashtag] 0 net-new handles from hashtag path (empty topHashtags or all seen)')
        return []
      }
      const batches = chunk(hashtagHandles, 10)
      const results = await Promise.all(batches.map((b) => limit(() => scrapeHandles(b, apifyKeys, signal))))
      const profiles = results.flat()
      console.log(`[hashtag] scraped ${profiles.length} profiles from content-niche path`)
      return profiles
    })(),
    // Round 3: expand pool from relatedHandles of Round 2 candidates
    (async (): Promise<NormalizedProfile[]> => {
      if (round3Handles.length === 0) {
        console.log('[round3] 0 net-new handles — relatedProfiles graph is closed for these reference accounts')
        return []
      }
      const batches = chunk(round3Handles, 10)
      const results = await Promise.all(batches.map((b) => limit(() => scrapeHandles(b, apifyKeys, signal))))
      const profiles = results.flat()
      console.log(`[round3] scraped ${profiles.length} profiles`)
      return profiles
    })(),
  ])

  // Tag each path's profiles with their discovery source so Gemini can tell which
  // candidates come from the content-niche signal vs audience-adjacency signal.
  const taggedHashtagProfiles = hashtagProfiles.map((p) => ({ ...p, discoverySource: 'hashtag' as const }))
  const taggedRound3Profiles = round3Profiles.map((p) => ({ ...p, discoverySource: 'round3' as const }))

  // Merge order: hashtag (content-niche) first — Gemini's context window reads top-down,
  // so placing the highest-confidence niche candidates first creates an ordering bias that
  // reinforces the SOURCE PRIORITY instruction in the prompt.
  const allCandidates = [...taggedHashtagProfiles, ...round2Profiles, ...taggedRound3Profiles]
  console.log(`[pipeline] total candidates: ${allCandidates.length} (hashtag: ${taggedHashtagProfiles.length}, r2: ${round2Profiles.length}, r3: ${taggedRound3Profiles.length})`)

  // Dead account gate: remove inactive accounts before handing the pool to Gemini.
  // Accounts with no posts or last post >180 days ago are not active competitors —
  // keeping them wastes context window tokens and degrades ranking quality.
  // Computed at call time (not module scope) so tests don't get stale timestamps.
  const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000
  const candidateProfiles = allCandidates.filter((p) => {
    if (p.postsCount === 0) return false
    if (p.lastPostDate) {
      const lastPostTs = new Date(p.lastPostDate).getTime()
      if (!isNaN(lastPostTs) && lastPostTs < sixMonthsAgo) return false
    }
    return true
  })
  const removedCount = allCandidates.length - candidateProfiles.length
  if (removedCount > 0) {
    console.log(`[dead-account-gate] removed ${removedCount} inactive accounts (0 posts or last post >180 days ago)`)
  }

  return { inputProfiles, candidateProfiles }
}

