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
import { devLog } from './devLog'
import { ACTORS, buildProfileScraperInput, buildHashtagScraperInput, buildSearchScraperInput } from './actors'
import { normalizeProfiles, type ApifyProfileRaw, type NormalizedProfile } from './transformers'
import { startRun, pollRun, fetchDataset, chunk, withKeyFailover } from './apifyCore'
import { generateNicheSeeds, matchesIntendedIdentity, SEARCH_RESULT_CAP } from './knowledgeSeed'
import { deriveNicheFromProfiles } from './deriveNiche'

// Re-export shared error class so existing callers don't need to change their imports
export { ApifyError, type ApifyErrorCode } from './apifyCore'

const MAX_CONCURRENT = 3        // p-limit cap for concurrent actor runs

// Concurrency limiter — prevents firing too many actor runs simultaneously
const limit = pLimit(MAX_CONCURRENT)

// Dedicated limiter for the SPECULATIVE recall sources (knowledge seed A/B + IG keyword search C).
// Separate from `limit` so these NEW scrapes run concurrently with the graph walk instead of
// queueing behind Round 2/hashtag/Round 3 on the same 3 slots — the latency fix for CR-1. They get
// their own 3 slots; both pools draw distinct keys via the proxy's per-run key rotation.
const speculativeLimit = pLimit(3)

// Source precedence for cross-source dedup + prompt ordering (lower = higher confidence; kept on
// conflict and placed earlier in the candidate list so the ranker reads strongest signals first).
const SOURCE_PRECEDENCE: Record<string, number> = {
  knowledge: 0, hashtag: 1, search: 2, relatedProfiles: 3, round3: 4,
}

/** Dedup candidates by username, keeping the highest-precedence discoverySource on conflict. */
function dedupBySource(profiles: NormalizedProfile[]): NormalizedProfile[] {
  const best = new Map<string, NormalizedProfile>()
  for (const p of profiles) {
    const key = p.username.toLowerCase()
    const existing = best.get(key)
    if (!existing) { best.set(key, p); continue }
    const incoming = SOURCE_PRECEDENCE[p.discoverySource ?? ''] ?? 99
    const current = SOURCE_PRECEDENCE[existing.discoverySource ?? ''] ?? 99
    if (incoming < current) best.set(key, p)
  }
  return [...best.values()]
}

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
export async function scrapeHandles(
  handles: string[],
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<NormalizedProfile[]> {
  const input = buildProfileScraperInput(handles)
  // Per-run key failover: spreads across accounts AND rolls a tapped-out key (402) to a funded one.
  const raw = await withKeyFailover(apifyKeys, async (apiKey) => {
    const { runId, datasetId, keyIndex } = await startRun(ACTORS.PROFILE_SCRAPER, input, apiKey, signal)
    const resolvedDatasetId = await pollRun(runId, apiKey, signal, undefined, keyIndex)
    return fetchDataset<ApifyProfileRaw>(resolvedDatasetId || datasetId, apiKey, signal, keyIndex)
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
  perHashtag = 35,
): Promise<string[]> {
  if (hashtags.length === 0) return []

  const top5 = hashtags.slice(0, 5)
  const input = buildHashtagScraperInput(top5, perHashtag)
  const posts = await withKeyFailover(apifyKeys, async (apiKey) => {
    const { runId, datasetId, keyIndex } = await startRun(ACTORS.HASHTAG_SCRAPER, input, apiKey, signal)
    const resolvedDatasetId = await pollRun(runId, apiKey, signal, undefined, keyIndex)
    return fetchDataset<HashtagPostRaw>(resolvedDatasetId || datasetId, apiKey, signal, keyIndex)
  })

  // Extract ownerUsername from each post, drop missing/empty values
  const usernames = posts
    .map((p) => p.ownerUsername?.trim().toLowerCase())
    .filter((u): u is string => Boolean(u))

  // Deduplicate
  return [...new Set(usernames)]
}

/** Raw account row from the Search Scraper (searchType:'user') — account search yields `username`. */
interface SearchAccountRaw {
  username?: string
}

/**
 * Component C: find ACCOUNTS by keyword via apify~instagram-scraper (searchType:'user').
 * Returns unique usernames — the caller profile-scrapes them, mirroring the hashtag two-step.
 * NOTE: account search returns `username` (NOT `ownerUsername` like the hashtag/post path).
 */
export async function scrapeSearchUsernames(
  keyword: string,
  apifyKeys: string[],
  signal?: AbortSignal,
  searchLimit = SEARCH_RESULT_CAP,
): Promise<string[]> {
  const trimmed = keyword.trim()
  if (!trimmed) return []
  const input = buildSearchScraperInput(trimmed, searchLimit)
  const rows = await withKeyFailover(apifyKeys, async (apiKey) => {
    const { runId, datasetId, keyIndex } = await startRun(ACTORS.SEARCH_SCRAPER, input, apiKey, signal)
    const resolvedDatasetId = await pollRun(runId, apiKey, signal, undefined, keyIndex)
    return fetchDataset<SearchAccountRaw>(resolvedDatasetId || datasetId, apiKey, signal, keyIndex)
  })
  const usernames = rows
    .map((r) => r.username?.trim().toLowerCase())
    .filter((u): u is string => Boolean(u))
  return [...new Set(usernames)]
}

/**
 * Scrape handles with PER-BATCH fault isolation (CR-2). Speculative (LLM/search-named) handles
 * are adversarial input the batch path isn't isolated against: scrapeHandles puts 10 handles in
 * ONE run and Promise.all fail-fasts, so a single hard run-failure could collapse the source AND
 * the trusted graph walk running in parallel. Here each batch runs under Promise.allSettled on the
 * DEDICATED limiter, so a failed batch drops only its ≤10 handles — never the graph walk, never
 * the other batches. (Non-existent handles are normally just omitted by the actor, run SUCCEEDED.)
 */
async function scrapeHandlesIsolated(
  handles: string[],
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<NormalizedProfile[]> {
  const batches = chunk(handles, 10)
  const settled = await Promise.allSettled(
    batches.map((b) => speculativeLimit(() => scrapeHandles(b, apifyKeys, signal))),
  )
  const out: NormalizedProfile[] = []
  for (const r of settled) if (r.status === 'fulfilled') out.push(...r.value)
  return out
}

/**
 * Run the SPECULATIVE recall sources for a niche: knowledge seed (A + B) and IG keyword search (C).
 * Each leg generates handles → scrape-verifies them (fault-isolated) → tags discoverySource. The
 * knowledge leg additionally applies the identity gate (CR-2) so a scraped-but-wrong account never
 * surfaces. Runs on the dedicated limiter and each leg degrades to [] independently on failure, so
 * a slow/failed source returns a partial pool instead of aborting the run (CR-1 graceful degrade).
 */
async function discoverSpeculativeSources(
  niche: string,
  inputProfiles: NormalizedProfile[],
  geminiKeys: string[],
  apifyKeys: string[],
  mode: 'precise' | 'broad',
  signal?: AbortSignal,
): Promise<{ profiles: NormalizedProfile[]; nicheBriefing: string }> {
  const seenInput = new Set(inputProfiles.map((p) => p.username.toLowerCase()))

  const [knowledge, searchProfiles] = await Promise.all([
    // A + B: AI web-researches the niche (briefing) AND names creators in ONE grounded call →
    // scrape-verify → identity gate → tag 'knowledge'. The briefing rides out for the ranking prompt.
    (async (): Promise<{ profiles: NormalizedProfile[]; briefing: string }> => {
      const { briefing, candidates } = await generateNicheSeeds(geminiKeys, niche, inputProfiles, mode, signal)
      const handles = candidates.map((s) => s.handle).filter((h) => !seenInput.has(h))
      if (handles.length === 0) return { profiles: [], briefing }
      const scraped = await scrapeHandlesIsolated(handles, apifyKeys, signal)
      const seedByHandle = new Map(candidates.map((s) => [s.handle, s]))
      const verified = scraped.filter((p) => {
        const seed = seedByHandle.get(p.username.toLowerCase())
        return seed ? matchesIntendedIdentity(p, seed) : false
      })
      const dropped = scraped.length - verified.length
      if (dropped > 0) devLog(`[knowledge] identity gate dropped ${dropped}/${scraped.length} scraped seeds (possible wrong-person matches)`)
      return { profiles: verified.map((p) => ({ ...p, discoverySource: 'knowledge' as const })), briefing }
    })().catch((): { profiles: NormalizedProfile[]; briefing: string } => ({ profiles: [], briefing: '' })),
    // C: IG keyword/account search → scrape-verify → tag 'search'.
    (async (): Promise<NormalizedProfile[]> => {
      const usernames = await scrapeSearchUsernames(niche, apifyKeys, signal).catch(() => [] as string[])
      const handles = usernames.filter((h) => !seenInput.has(h)).slice(0, SEARCH_RESULT_CAP)
      if (handles.length === 0) return []
      const scraped = await scrapeHandlesIsolated(handles, apifyKeys, signal)
      return scraped.map((p) => ({ ...p, discoverySource: 'search' as const }))
    })().catch((): NormalizedProfile[] => []),
  ])

  devLog(`[speculative] knowledge: ${knowledge.profiles.length}, search: ${searchProfiles.length}`)
  return { profiles: [...knowledge.profiles, ...searchProfiles], nicheBriefing: knowledge.briefing }
}

// ----- Public API: 2-round competitor discovery -----

export interface ScrapeResult {
  inputProfiles: NormalizedProfile[]
  candidateProfiles: NormalizedProfile[]
  /** Web-grounded niche/sub-niche briefing from the knowledge-seed call — fed into the ranking
   *  prompt for sharper subniche understanding. Empty when no niche was given or grounding failed. */
  nicheBriefing?: string
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
  opts?: { niche?: string; geminiKeys?: string[]; mode?: 'precise' | 'broad' },
): Promise<ScrapeResult> {
  const niche = (opts?.niche ?? '').trim()
  const mode = opts?.mode ?? 'precise'
  const geminiKeys = opts?.geminiKeys ?? []

  // Round 1: scrape input handles → profiles, relatedHandles, topHashtags. Skipped when no handles
  // are given — the niche-only bootstrap builds the pool purely from the speculative sources.
  const inputProfiles = inputHandles.length > 0
    ? await scrapeHandles(inputHandles, apifyKeys, signal)
    : []

  // Web-search fallback: a bare `@handle` search (no explicit niche) whose relatedProfiles graph
  // is closed yields an empty pool and the "no related public accounts" dead-end. Derive a niche
  // from the scraped reference profile so the web-grounded seed sources can still build a pool from
  // creators the graph can't reach. A given niche always wins; derivation only fills the gap.
  const effectiveNiche = niche || deriveNicheFromProfiles(inputProfiles)

  // Kick off the SPECULATIVE recall sources NOW (knowledge A/B + search C). They only need the
  // niche + reference profiles and run on a dedicated limiter, so they execute CONCURRENTLY with
  // the graph walk below instead of queueing behind it (CR-1). No derivable niche → no speculative pool.
  const speculativePromise: Promise<{ profiles: NormalizedProfile[]; nicheBriefing: string }> = effectiveNiche
    ? discoverSpeculativeSources(effectiveNiche, inputProfiles, geminiKeys, apifyKeys, mode, signal)
    : Promise.resolve({ profiles: [], nicheBriefing: '' })

  // Build seen set to avoid re-scraping any handle
  const seenHandles = new Set(inputHandles.map((h) => h.replace(/^@/, '').toLowerCase()))

  // Extract candidate handles from Round 1 relatedProfiles.
  // Sort by cross-profile adjacency frequency (handles appearing in more input profiles'
  // relatedHandles are higher-signal) then cap to avoid unbounded Round 2 scrapes (2.13).
  const allRelated = inputProfiles.flatMap((p) => p.relatedHandles)
  const handleFreq = new Map<string, number>()
  for (const h of allRelated) handleFreq.set(h, (handleFreq.get(h) ?? 0) + 1)
  const candidateHandles = [...new Set(allRelated)]
    .filter((h) => !seenHandles.has(h.toLowerCase()))
    .sort((a, b) => (handleFreq.get(b) ?? 0) - (handleFreq.get(a) ?? 0))
    .slice(0, depth === 'deep' ? 40 : 25)

  // The relatedProfiles + hashtag + Round-3 graph walk runs only when Round 1 yielded a graph to
  // walk; otherwise the speculative sources carry the pool. Wrapped in an IIFE so the graph-walk
  // body is unchanged and the empty-graph case short-circuits to [].
  const graphCandidates: NormalizedProfile[] = candidateHandles.length === 0 ? [] : await (async (): Promise<NormalizedProfile[]> => {

  // Extract hashtags from input profiles for content-niche expansion, ranked by
  // CROSS-PROFILE frequency (how many reference accounts use each tag). A plain Set
  // kept first-seen order, so a single sparse/noisy reference account (e.g. one whose
  // only tags are #ad #collab) could dictate the entire hashtag scrape. Frequency
  // ranking mirrors the relatedHandles sort above: a tag shared by multiple references
  // is a far stronger niche signal than one seen on a single account.
  const hashtagCrossFreq = new Map<string, number>()
  for (const p of inputProfiles) {
    for (const h of p.topHashtags) hashtagCrossFreq.set(h, (hashtagCrossFreq.get(h) ?? 0) + 1)
  }
  const uniqueHashtags = [...hashtagCrossFreq.keys()]
    .sort((a, b) => (hashtagCrossFreq.get(b) ?? 0) - (hashtagCrossFreq.get(a) ?? 0))

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
  // Cap at 40 (4 batches) — the content-niche path is the highest-precision source and
  // feeds the small on-niche accounts Trending needs, so we give it more reach than Round 3.
  const hashtagHandles = hashtagUsernames
    .filter((h) => !seenHandles.has(h))
    .slice(0, 40)

  devLog(`[hashtag] ${hashtagHandles.length} net-new handles from content-niche expansion (${uniqueHashtags.slice(0, 5).join(', ')})`)

  // Add hashtag handles to seen BEFORE computing Round 3 — prevents overlap between
  // the two parallel scrapes, keeping the combined pool clean.
  hashtagHandles.forEach((h) => seenHandles.add(h))

  // Compute Round 3 handles (now filtered against round1+round2+hashtag seen set).
  const round3Cap = ROUND3_CAP[depth]
  const round3Related = round2Profiles.flatMap((p) => p.relatedHandles)
  const round3Handles = [...new Set(round3Related)]
    .filter((h) => !seenHandles.has(h.toLowerCase()))
    .slice(0, round3Cap)

  devLog(`[round3] ${round3Handles.length} net-new handles (cap: ${round3Cap}, seen: ${seenHandles.size})`)

  // Hashtag profile scrape + Round 3 run IN PARALLEL.
  // Both only need data already available (round2Profiles and hashtagHandles),
  // so there is no dependency between them. Sequential cost was ~50s; parallel = ~25s.
  const [hashtagProfiles, round3Profiles] = await Promise.all([
    // Hashtag path: profile-scrape the content-niche handles
    (async (): Promise<NormalizedProfile[]> => {
      if (hashtagHandles.length === 0) {
        devLog('[hashtag] 0 net-new handles from hashtag path (empty topHashtags or all seen)')
        return []
      }
      const batches = chunk(hashtagHandles, 10)
      const results = await Promise.all(batches.map((b) => limit(() => scrapeHandles(b, apifyKeys, signal))))
      const profiles = results.flat()
      devLog(`[hashtag] scraped ${profiles.length} profiles from content-niche path`)
      return profiles
    })(),
    // Round 3: expand pool from relatedHandles of Round 2 candidates
    (async (): Promise<NormalizedProfile[]> => {
      if (round3Handles.length === 0) {
        devLog('[round3] 0 net-new handles — relatedProfiles graph is closed for these reference accounts')
        return []
      }
      const batches = chunk(round3Handles, 10)
      const results = await Promise.all(batches.map((b) => limit(() => scrapeHandles(b, apifyKeys, signal))))
      const profiles = results.flat()
      devLog(`[round3] scraped ${profiles.length} profiles`)
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
    devLog(`[graph-walk] candidates: ${allCandidates.length} (hashtag: ${taggedHashtagProfiles.length}, r2: ${round2Profiles.length}, r3: ${taggedRound3Profiles.length})`)
    return allCandidates
  })()

  // Merge graph-walk + speculative sources, dedup by username (source precedence), and order
  // strongest-signal-first so the ranker's top-down read reinforces SOURCE PRIORITY.
  const { profiles: speculativeProfiles, nicheBriefing } = await speculativePromise
  const merged = dedupBySource([...graphCandidates, ...speculativeProfiles])
    .sort((a, b) => (SOURCE_PRECEDENCE[a.discoverySource ?? ''] ?? 99) - (SOURCE_PRECEDENCE[b.discoverySource ?? ''] ?? 99))
  devLog(`[pipeline] merged candidates: ${merged.length} (graph: ${graphCandidates.length}, speculative: ${speculativeProfiles.length})`)

  // Dead account gate: remove inactive accounts before handing the pool to Gemini.
  // Accounts with no posts or last post >180 days ago are not active competitors —
  // keeping them wastes context window tokens and degrades ranking quality. Now also drops
  // dead AI-named / search-found accounts (part of the speculative verify step).
  const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000
  const candidateProfiles = merged.filter((p) => {
    if (p.postsCount === 0) return false
    if (p.lastPostDate) {
      const lastPostTs = new Date(p.lastPostDate).getTime()
      if (!isNaN(lastPostTs) && lastPostTs < sixMonthsAgo) return false
    }
    return true
  })
  const removedCount = merged.length - candidateProfiles.length
  if (removedCount > 0) {
    devLog(`[dead-account-gate] removed ${removedCount} inactive accounts (0 posts or last post >180 days ago)`)
  }

  return { inputProfiles, candidateProfiles, nicheBriefing }
}

