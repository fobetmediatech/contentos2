/**
 * Reel Analyzer — orchestrates per-reel AI classification and cross-creator synthesis.
 *
 * Main exports:
 *   analyzeReel       — quick caption-only classification via Gemini (hook archetype, retention)
 *   analyzeReelDeep   — DEEP multimodal analysis via the Vercel function (watches the video)
 *   synthesizeNiche   — synthesize cross-creator niche insights from per-creator summaries
 *
 * Plus a helper:
 *   buildPerCreatorSummary — compute PerCreatorSummary from completed analyses + reel data
 */

import { callGeminiWithSchema } from '../ai/gemini'
import { getClerkSessionToken } from './clerkToken'
import { buildReelAnalysisPrompt, REEL_ANALYSIS_SCHEMA, buildReelAnalysisBatchPrompt, REEL_ANALYSIS_BATCH_SCHEMA, buildSynthesisPrompt, SYNTHESIS_SCHEMA } from '../ai/prompts/reelAnalysis'
import { buildDeepReportPrompt, DEEP_REPORT_SCHEMA } from '../ai/prompts/deepReelAnalysis'
import {
  buildMapPrompt,
  buildReducePrompt,
  parseCreatorHookSummary,
  parseCreatorHookSummaryDraft,
  CREATOR_HOOK_SUMMARY_SCHEMA,
} from '../ai/prompts/creatorHookSummary'
import type { CreatorHookSummary, CreatorHookSummaryDraft } from '../ai/prompts/creatorHookSummary'
import {
  buildReelDigest,
  digestText,
  planDigestChunks,
  estimateTokens,
  SUMMARY_INPUT_TOKEN_BUDGET,
} from './reelDigest'
import { devWarn } from './devLog'
import type { SingleReelResult } from '../store/singleReelStore'
import { getCachedQuick, setCachedQuick } from './quickReelCache'
import type {
  DeepReelAnalysis,
  DeepCreatorPlaybook,
  DeepReportSynthesis,
  DeepReportComparisonRow,
  DeepReportExemplar,
  DeepNicheReport,
} from '../ai/prompts/deepReelAnalysis'
import type {
  ReelData,
  ReelAnalysis,
  PerCreatorSummary,
  SynthesisOutput,
  StoredDeepReelAnalysis,
} from '../store/reelAnalysisStore'

/** Same-origin Vercel function that does the multimodal video analysis (server-side). */
const ANALYZE_REEL_FN = '/api/analyze-reel-video'

/** Thrown when the deep-analysis function call fails; carries the HTTP status. */
export class DeepAnalysisError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'DeepAnalysisError'
    this.status = status
  }
}

/**
 * Deep, video-grounded analysis of a single reel.
 *
 * POSTs the STABLE downloadedVideo URL (resolved client-side by reelVideoClient)
 * to the Vercel function, which fetches the bytes + runs Gemini multimodal and
 * returns a DeepReelAnalysis. commentsLikesRatio is computed here (client-side,
 * deterministic), matching the quick-path convention.
 *
 * Throws DeepAnalysisError on failure so the orchestrator can mark the reel failed
 * (never surfaces raw server text to the UI).
 */
export async function analyzeReelDeep(
  reel: ReelData,
  downloadedVideoUrl: string,
  signal?: AbortSignal,
): Promise<StoredDeepReelAnalysis> {
  // Auth: the function verifies the Clerk session JWT server-side. The old
  // VITE_REEL_FN_SECRET shared-secret header was removed — a static secret in
  // the public bundle gates nothing.
  const reqBody = JSON.stringify({ downloadedVideoUrl, shortCode: reel.shortCode, caption: reel.caption })
  const post = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = await getClerkSessionToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    return fetch(ANALYZE_REEL_FN, { method: 'POST', headers, body: reqBody, signal })
  }

  let res: Response
  try {
    res = await post()
    // A 401 here under the deep report's concurrent burst is almost always a transient token
    // miss — retry ONCE with a freshly fetched (coalesced) token before failing the reel.
    if (res.status === 401) res = await post()
  } catch (err) {
    if (signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
      throw new DeepAnalysisError('Aborted', 0)
    }
    throw new DeepAnalysisError('Deep analysis request failed', 0)
  }

  if (!res.ok) throw new DeepAnalysisError('Deep analysis failed', res.status)

  const body = (await res.json()) as { analysis: DeepReelAnalysis }
  const commentsLikesRatio = reel.commentsCount / Math.max(1, reel.likesCount)
  return { ...body.analysis, commentsLikesRatio }
}

// ---------------------------------------------------------------------------
// analyzeReel
// ---------------------------------------------------------------------------

/**
 * Classify a single reel's hook archetype and retention mechanics via Gemini.
 *
 * commentsLikesRatio is computed client-side and NOT delegated to Gemini —
 * it is a deterministic arithmetic operation from the reel's raw metrics.
 */
export async function analyzeReel(
  reel: ReelData,
  geminiKey: string | string[],
  signal?: AbortSignal,
): Promise<ReelAnalysis> {
  const prompt = buildReelAnalysisPrompt(reel)

  const raw = await callGeminiWithSchema<{
    hookArchetype: string
    secondaryArchetype?: string
    openingLine?: string
    retentionMechanism: string
    psychologyTrigger: string
    replicationTemplate: string
    lowConfidenceNote?: string
  }>(geminiKey, prompt, REEL_ANALYSIS_SCHEMA, { temperature: 0.3, thinkingBudget: 0, signal })

  const commentsLikesRatio = reel.commentsCount / Math.max(1, reel.likesCount)

  return {
    hookArchetype: raw.hookArchetype,
    secondaryArchetype: raw.secondaryArchetype,
    openingLine: raw.openingLine,
    commentsLikesRatio,
    retentionMechanism: raw.retentionMechanism,
    psychologyTrigger: raw.psychologyTrigger,
    replicationTemplate: raw.replicationTemplate,
    lowConfidenceNote: raw.lowConfidenceNote,
  }
}

// ---------------------------------------------------------------------------
// analyzeReelsBatch
// ---------------------------------------------------------------------------

/**
 * Analyse all reels for a creator in a single Gemini call, with per-reel caching.
 *
 * - Cache hits are returned immediately (no Gemini call for already-analysed reels).
 * - All cache misses are batched into ONE callGeminiWithSchema call (array responseSchema).
 * - Results are written back to cache before returning.
 * - commentsLikesRatio is computed client-side after the Gemini response (not in schema).
 *
 * Returns a Record<shortCode, ReelAnalysis> covering all input reels.
 */
export async function analyzeReelsBatch(
  reels: ReelData[],
  geminiKey: string | string[],
  signal?: AbortSignal,
): Promise<Record<string, ReelAnalysis>> {
  if (reels.length === 0) return {}

  // Check cache for each reel.
  const cached: Record<string, ReelAnalysis> = {}
  const uncached: ReelData[] = []
  await Promise.all(
    reels.map(async (reel) => {
      const hit = await getCachedQuick(reel.shortCode)
      if (hit) {
        cached[reel.shortCode] = hit
      } else {
        uncached.push(reel)
      }
    }),
  )

  if (uncached.length === 0) return cached

  // Batch all cache-miss reels into a single Gemini call.
  // Schema root is type:'object' (Gemini rejects root arrays) — unwrap .analyses after.
  const prompt = buildReelAnalysisBatchPrompt(uncached)
  const { analyses: rawArray } = await callGeminiWithSchema<{
    analyses: Array<{
      hookArchetype: string
      secondaryArchetype?: string
      openingLine?: string
      retentionMechanism: string
      psychologyTrigger: string
      replicationTemplate: string
      lowConfidenceNote?: string
    }>
  }>(geminiKey, prompt, REEL_ANALYSIS_BATCH_SCHEMA, { temperature: 0.3, thinkingBudget: 0, signal })

  // Map array response back to reels by index, compute client-side ratio, write cache.
  const fresh: Record<string, ReelAnalysis> = {}
  await Promise.all(
    uncached.map(async (reel, i) => {
      const raw = rawArray[i]
      if (!raw) return // safety: Gemini returned fewer items than expected
      const analysis: ReelAnalysis = {
        hookArchetype: raw.hookArchetype,
        secondaryArchetype: raw.secondaryArchetype,
        openingLine: raw.openingLine,
        commentsLikesRatio: reel.commentsCount / Math.max(1, reel.likesCount),
        retentionMechanism: raw.retentionMechanism,
        psychologyTrigger: raw.psychologyTrigger,
        replicationTemplate: raw.replicationTemplate,
        lowConfidenceNote: raw.lowConfidenceNote,
      }
      fresh[reel.shortCode] = analysis
      await setCachedQuick(reel.shortCode, analysis)
    }),
  )

  return { ...cached, ...fresh }
}

// ---------------------------------------------------------------------------
// synthesizeNiche
// ---------------------------------------------------------------------------

/**
 * Synthesize cross-creator niche insights from an array of PerCreatorSummary objects.
 *
 * Returns top hook patterns, benchmarks, and actionable replicate/avoid tips.
 */
export async function synthesizeNiche(
  summaries: PerCreatorSummary[],
  geminiKey: string | string[],
  benchmarks: SynthesisOutput['benchmarks'],
  signal?: AbortSignal,
): Promise<SynthesisOutput> {
  const prompt = buildSynthesisPrompt(summaries)

  // Gemini returns ONLY the qualitative synthesis; benchmarks are computed in code (M5).
  const raw = await callGeminiWithSchema<{
    topPatterns?: Array<{ archetype?: string; count?: number; example?: string }>
    replicateTips?: string[]
    avoidTips?: string[]
  }>(geminiKey, prompt, SYNTHESIS_SCHEMA, { temperature: 0.4, thinkingBudget: 0, signal })

  // M4: coerce/guard the LLM output so a missing or mistyped field can't crash the UI.
  const topPatterns = Array.isArray(raw.topPatterns)
    ? raw.topPatterns
        .filter((p): p is { archetype: string; count?: number; example?: string } => !!p && typeof p.archetype === 'string')
        .map((p) => ({ archetype: p.archetype, count: Number(p.count) || 0, example: p.example ?? '' }))
    : []
  const replicateTips = Array.isArray(raw.replicateTips)
    ? raw.replicateTips.filter((t): t is string => typeof t === 'string')
    : []
  const avoidTips = Array.isArray(raw.avoidTips)
    ? raw.avoidTips.filter((t): t is string => typeof t === 'string')
    : []

  return { topPatterns, benchmarks, replicateTips, avoidTips }
}

// ---------------------------------------------------------------------------
// synthesizeCreatorHooks (Profile HookMap — context-safe, map-reduce)
// ---------------------------------------------------------------------------

/**
 * Synthesize ~10 per-reel HookMap case studies into ONE creator-level CreatorHookSummary.
 *
 * Context-safe by construction:
 *   1. Each reel-with-case-study is condensed via `buildReelDigest` (Task 2.1) so the input
 *      is small even for a full profile.
 *   2. Digests are token-budgeted into chunks (`planDigestChunks`). If everything fits in one
 *      chunk we make a SINGLE map call. Otherwise we map each chunk → partials → reduce.
 *   3. The reduce input is itself budgeted: if the joined partials still exceed budget we
 *      reduce RECURSIVELY in batches until one summary remains. So we never overflow context.
 *
 * Resilience:
 *   - Map calls are best-effort: a failing chunk is logged (devWarn) and skipped, not fatal.
 *   - If EVERY map chunk fails (or there are no case studies) → returns null.
 *   - Honours `signal`: returns null if already aborted (no calls), and AbortError from any
 *     Gemini call short-circuits to null.
 *
 * Benchmarks (medianViews/medianLikes/commentsLikesRatio) are computed in code from the raw
 * reels — never asked of the LLM (mirrors computeBenchmarks).
 *
 * @param caseStudies  shortCode -> SingleReelResult (the per-reel HookMap case studies)
 * @param reels        the creator's reels (for metrics, keyed by shortCode)
 */
export async function synthesizeCreatorHooks(
  handle: string,
  caseStudies: Record<string, SingleReelResult>,
  reels: ReelData[],
  geminiKeys: string | string[],
  signal?: AbortSignal,
  opts?: { budget?: number },
): Promise<CreatorHookSummary | null> {
  if (signal?.aborted) return null

  // Only reels that actually have a case study contribute.
  const analyzedReels = reels.filter((r) => caseStudies[r.shortCode])
  if (analyzedReels.length === 0) return null

  const digests = analyzedReels.map((r) => buildReelDigest(caseStudies[r.shortCode], r))
  const reelCount = digests.length

  // Benchmarks computed in code from the analysed reels (deterministic).
  const benchmarks = {
    medianViews: computeMedian(analyzedReels.map((r) => r.videoViewCount)),
    medianLikes: computeMedian(analyzedReels.map((r) => r.likesCount)),
    commentsLikesRatio: (() => {
      const totalLikes = analyzedReels.reduce((s, r) => s + r.likesCount, 0)
      const totalComments = analyzedReels.reduce((s, r) => s + r.commentsCount, 0)
      return totalLikes > 0 ? totalComments / totalLikes : 0
    })(),
  }

  const budget = opts?.budget ?? SUMMARY_INPUT_TOKEN_BUDGET
  const chunks = planDigestChunks(digests, budget)

  // Fast path: everything fits in one chunk → single map call, no reduce.
  if (chunks.length === 1) {
    if (signal?.aborted) return null
    try {
      const raw = await callGeminiWithSchema<unknown>(
        geminiKeys,
        buildMapPrompt(handle, chunks[0].map(digestText)),
        CREATOR_HOOK_SUMMARY_SCHEMA,
        { temperature: 0.4, thinkingBudget: 0, signal },
      )
      return parseCreatorHookSummary(raw, handle, reelCount, benchmarks)
    } catch (err) {
      if (isAbort(err, signal)) return null
      devWarn('[synthesizeCreatorHooks] single-chunk map failed', err)
      return null
    }
  }

  // Map-reduce path: summarise each chunk (best-effort), then reduce the partials.
  const partials: CreatorHookSummaryDraft[] = []
  for (const chunk of chunks) {
    if (signal?.aborted) return null
    try {
      const raw = await callGeminiWithSchema<unknown>(
        geminiKeys,
        buildMapPrompt(handle, chunk.map(digestText)),
        CREATOR_HOOK_SUMMARY_SCHEMA,
        { temperature: 0.4, thinkingBudget: 0, signal },
      )
      partials.push(parseCreatorHookSummaryDraft(raw))
    } catch (err) {
      if (isAbort(err, signal)) return null
      devWarn('[synthesizeCreatorHooks] map chunk failed — skipping', err)
    }
  }

  // Every chunk failed → nothing to reduce.
  if (partials.length === 0) return null

  const finalDraft = await reducePartials(handle, partials, geminiKeys, budget, signal)
  if (finalDraft === null) return null

  return { handle, reelCount, ...finalDraft, benchmarks }
}

/**
 * Reduce partial summaries into one. The reduce input is token-budgeted: if all partials
 * don't fit in one prompt, reduce them in budgeted batches and recurse over the batch outputs
 * until a single summary remains. Returns null on abort or if the reduce call fails.
 */
async function reducePartials(
  handle: string,
  partials: CreatorHookSummaryDraft[],
  geminiKeys: string | string[],
  budget: number,
  signal?: AbortSignal,
): Promise<CreatorHookSummaryDraft | null> {
  if (signal?.aborted) return null
  if (partials.length === 1) return partials[0]

  // Batch into groups of >= 2 partials each: a 1-element batch can't be reduced further
  // (it IS the reduced form) and would loop forever, so the budget floor is overridden to
  // guarantee every batch makes progress (output count strictly shrinks).
  const batches = batchByTokenBudget(partials, budget)

  // If everything fits in one batch, do a single reduce call.
  if (batches.length === 1) {
    try {
      const raw = await callGeminiWithSchema<unknown>(
        geminiKeys,
        buildReducePrompt(handle, batches[0]),
        CREATOR_HOOK_SUMMARY_SCHEMA,
        { temperature: 0.4, thinkingBudget: 0, signal },
      )
      return parseCreatorHookSummaryDraft(raw)
    } catch (err) {
      if (isAbort(err, signal)) return null
      devWarn('[synthesizeCreatorHooks] reduce failed', err)
      return null
    }
  }

  // Otherwise reduce each multi-partial batch, then recurse over the outputs. A single-partial
  // batch is passed through unchanged (no call) so the partial count always strictly decreases.
  const reduced: CreatorHookSummaryDraft[] = []
  for (const batch of batches) {
    if (signal?.aborted) return null
    if (batch.length === 1) {
      reduced.push(batch[0])
      continue
    }
    try {
      const raw = await callGeminiWithSchema<unknown>(
        geminiKeys,
        buildReducePrompt(handle, batch),
        CREATOR_HOOK_SUMMARY_SCHEMA,
        { temperature: 0.4, thinkingBudget: 0, signal },
      )
      reduced.push(parseCreatorHookSummaryDraft(raw))
    } catch (err) {
      if (isAbort(err, signal)) return null
      devWarn('[synthesizeCreatorHooks] reduce batch failed — skipping', err)
    }
  }

  if (reduced.length === 0) return null
  // Progress guard: if nothing collapsed (all batches were singletons), force one final reduce
  // over everything to avoid an infinite recursion under a pathologically tiny budget.
  if (reduced.length >= partials.length) {
    try {
      const raw = await callGeminiWithSchema<unknown>(
        geminiKeys,
        buildReducePrompt(handle, reduced),
        CREATOR_HOOK_SUMMARY_SCHEMA,
        { temperature: 0.4, thinkingBudget: 0, signal },
      )
      return parseCreatorHookSummaryDraft(raw)
    } catch (err) {
      if (isAbort(err, signal)) return null
      devWarn('[synthesizeCreatorHooks] final reduce failed', err)
      return null
    }
  }
  return reducePartials(handle, reduced, geminiKeys, budget, signal)
}

/** Split partial summaries into batches that each fit within the token budget. */
function batchByTokenBudget(partials: CreatorHookSummaryDraft[], budget: number): CreatorHookSummaryDraft[][] {
  const batches: CreatorHookSummaryDraft[][] = []
  let cur: CreatorHookSummaryDraft[] = []
  let curTokens = 0
  for (const p of partials) {
    const t = estimateTokens(JSON.stringify(p))
    if (cur.length > 0 && curTokens + t > budget) {
      batches.push(cur)
      cur = []
      curTokens = 0
    }
    cur.push(p)
    curTokens += t
  }
  if (cur.length > 0) batches.push(cur)
  return batches
}

/** True when an error is an abort (signal aborted or AbortError name). */
function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (err as { name?: string })?.name === 'AbortError'
}

// ---------------------------------------------------------------------------
// buildPerCreatorSummary
// ---------------------------------------------------------------------------

/**
 * Compute a PerCreatorSummary from the completed reel analyses and raw reel data for a creator.
 *
 * - dominantArchetype: most frequent hookArchetype across all analyses
 * - secondDominantArchetype: second most frequent (if exists and is different from dominant)
 * - topReelViews: max videoViewCount across reels
 * - medianViews: median of all videoViewCount values
 * - commentsLikesRatios: commentsLikesRatio from each analysis (order matches Object.values)
 * - reelCount: number of completed analyses
 */
export function buildPerCreatorSummary(
  handle: string,
  analyses: Record<string, ReelAnalysis>,
  reels: ReelData[],
): PerCreatorSummary {
  const analysisValues = Object.values(analyses)
  const reelCount = analysisValues.length

  // ---- Hook archetype frequency map ----
  const archetypeFreq: Record<string, number> = {}
  for (const analysis of analysisValues) {
    const arch = analysis.hookArchetype
    archetypeFreq[arch] = (archetypeFreq[arch] ?? 0) + 1
  }

  const sortedArchetypes = Object.entries(archetypeFreq).sort((a, b) => b[1] - a[1])
  const dominantArchetype = sortedArchetypes[0]?.[0] ?? ''
  const secondDominantArchetype =
    sortedArchetypes.length >= 2 && sortedArchetypes[1][0] !== dominantArchetype
      ? sortedArchetypes[1][0]
      : undefined

  // ---- View metrics ----
  const viewCounts = reels.map((r) => r.videoViewCount)
  const topReelViews = viewCounts.length > 0 ? Math.max(...viewCounts) : 0
  const medianViews = computeMedian(viewCounts)

  // ---- Comments/likes ratios from analyses ----
  const commentsLikesRatios = analysisValues.map((a) => a.commentsLikesRatio)

  return {
    handle,
    dominantArchetype,
    secondDominantArchetype,
    topReelViews,
    medianViews,
    commentsLikesRatios,
    reelCount,
  }
}

// ---------------------------------------------------------------------------
// computeBenchmarks
// ---------------------------------------------------------------------------

/**
 * Compute niche benchmarks from raw reel metrics — deterministically, in code.
 * M5: this was previously asked of the LLM, which is unreliable at arithmetic and
 * rendered its guesses as precise percentages. Code does the math; the LLM does
 * the pattern recognition.
 */
export function computeBenchmarks(reels: ReelData[]): SynthesisOutput['benchmarks'] {
  if (reels.length === 0) return { medianViews: 0, likesViewsRatio: 0, commentsLikesRatio: 0 }
  const totalViews = reels.reduce((sum, r) => sum + r.videoViewCount, 0)
  const totalLikes = reels.reduce((sum, r) => sum + r.likesCount, 0)
  const totalComments = reels.reduce((sum, r) => sum + r.commentsCount, 0)
  return {
    medianViews: computeMedian(reels.map((r) => r.videoViewCount)),
    likesViewsRatio: totalViews > 0 ? totalLikes / totalViews : 0,
    commentsLikesRatio: totalLikes > 0 ? totalComments / totalLikes : 0,
  }
}

// ---------------------------------------------------------------------------
// buildDeepPlaybook (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Build a per-creator deep playbook from the video-grounded DeepReelAnalysis set.
 *
 * Pure / code-computed (no LLM): archetype distribution, dominant + secondary archetype,
 * mean hook score, median views, a consistency score (how concentrated the archetype mix
 * is), and the standout exemplar (highest hookScore, views as tiebreak) whose
 * replicationTemplate becomes the creator's signature template.
 *
 * @param deepAnalyses  shortCode -> StoredDeepReelAnalysis (only `done` reels)
 * @param reels         the creator's reels (for view counts, keyed by shortCode)
 */
export function buildDeepPlaybook(
  handle: string,
  deepAnalyses: Record<string, StoredDeepReelAnalysis>,
  reels: ReelData[],
): DeepCreatorPlaybook {
  const entries = Object.entries(deepAnalyses)
  const reelCount = entries.length
  const viewsByShort = new Map(reels.map((r) => [r.shortCode, r.videoViewCount]))

  // Archetype frequency, sorted desc.
  const freq: Record<string, number> = {}
  for (const [, a] of entries) freq[a.hookArchetype] = (freq[a.hookArchetype] ?? 0) + 1
  const archetypeDistribution = Object.entries(freq)
    .map(([archetype, count]) => ({ archetype, count }))
    .sort((x, y) => y.count - x.count)

  const dominantArchetype = archetypeDistribution[0]?.archetype ?? ''
  const secondaryArchetype =
    archetypeDistribution.length >= 2 && archetypeDistribution[1].archetype !== dominantArchetype
      ? archetypeDistribution[1].archetype
      : undefined

  const avgHookScore = reelCount > 0 ? entries.reduce((s, [, a]) => s + a.hookScore, 0) / reelCount : 0
  const consistencyScore = reelCount > 0 ? (archetypeDistribution[0]?.count ?? 0) / reelCount : 0
  const medianViews = computeMedian(entries.map(([sc]) => viewsByShort.get(sc) ?? 0))

  // Standout exemplar: highest hookScore, views as tiebreak.
  let topExemplar: DeepCreatorPlaybook['topExemplar'] = null
  let bestRank = -1
  for (const [shortCode, a] of entries) {
    const views = viewsByShort.get(shortCode) ?? 0
    const rank = a.hookScore * 1e12 + views
    if (rank > bestRank) {
      bestRank = rank
      topExemplar = {
        shortCode,
        hookArchetype: a.hookArchetype,
        hookScore: a.hookScore,
        spokenHookVerbatim: a.spokenHookVerbatim,
        visualOpening: a.visualOpening,
        views,
      }
    }
  }
  const signatureTemplate = topExemplar ? deepAnalyses[topExemplar.shortCode].replicationTemplate : ''

  return {
    handle,
    reelCount,
    archetypeDistribution,
    dominantArchetype,
    secondaryArchetype,
    avgHookScore,
    medianViews,
    consistencyScore,
    signatureTemplate,
    topExemplar,
  }
}

// ---------------------------------------------------------------------------
// Cross-profile niche report (Phase 2)
// ---------------------------------------------------------------------------

type DeepReportTable = Pick<DeepNicheReport, 'archetypeDistribution' | 'comparison' | 'topExemplars'>

/**
 * Code-computed half of the niche report: cross-creator archetype distribution, a
 * comparison row per creator, and the top exemplar reels across all creators (sorted
 * by hookScore, views as tiebreak). Deterministic — no LLM (mirrors computeBenchmarks).
 */
export function buildDeepReportTable(playbooks: DeepCreatorPlaybook[]): DeepReportTable {
  const freq: Record<string, number> = {}
  for (const p of playbooks) {
    for (const d of p.archetypeDistribution) freq[d.archetype] = (freq[d.archetype] ?? 0) + d.count
  }
  const archetypeDistribution = Object.entries(freq)
    .map(([archetype, count]) => ({ archetype, count }))
    .sort((a, b) => b.count - a.count)

  const comparison: DeepReportComparisonRow[] = playbooks.map((p) => ({
    handle: p.handle,
    reelCount: p.reelCount,
    avgHookScore: Number(p.avgHookScore.toFixed(1)),
    medianViews: p.medianViews,
    dominantArchetype: p.dominantArchetype,
  }))

  const topExemplars: DeepReportExemplar[] = []
  for (const p of playbooks) {
    if (p.topExemplar) topExemplars.push({ handle: p.handle, ...p.topExemplar })
  }
  topExemplars.sort((a, b) => b.hookScore * 1e12 + b.views - (a.hookScore * 1e12 + a.views))

  return { archetypeDistribution, comparison, topExemplars }
}

/**
 * Gemini-synthesized half of the niche report: who's winning + why, the niche's winning
 * formula, gaps, and actionable replicate/avoid/test. Coerces/guards the LLM output
 * (mirrors synthesizeNiche) so a missing/mistyped field can't crash the report.
 */
export async function synthesizeDeepReport(
  playbooks: DeepCreatorPlaybook[],
  geminiKey: string | string[],
  signal?: AbortSignal,
): Promise<DeepReportSynthesis> {
  const raw = await callGeminiWithSchema<Partial<DeepReportSynthesis>>(
    geminiKey,
    buildDeepReportPrompt(playbooks),
    DEEP_REPORT_SCHEMA,
    { temperature: 0.4, thinkingBudget: 0, signal },
  )
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    whoIsWinning: str(raw.whoIsWinning),
    nicheFormula: str(raw.nicheFormula),
    gaps: arr(raw.gaps),
    replicate: arr(raw.replicate),
    avoid: arr(raw.avoid),
    test: arr(raw.test),
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}
