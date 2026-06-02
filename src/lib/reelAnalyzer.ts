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
import { buildReelAnalysisPrompt, REEL_ANALYSIS_SCHEMA, buildSynthesisPrompt, SYNTHESIS_SCHEMA } from '../ai/prompts/reelAnalysis'
import type { DeepReelAnalysis } from '../ai/prompts/deepReelAnalysis'
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const secret = import.meta.env.VITE_REEL_FN_SECRET
  if (secret) headers['x-reel-secret'] = secret

  let res: Response
  try {
    res = await fetch(ANALYZE_REEL_FN, {
      method: 'POST',
      headers,
      body: JSON.stringify({ downloadedVideoUrl, shortCode: reel.shortCode, caption: reel.caption }),
      signal,
    })
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
  geminiKey: string,
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
  }>(geminiKey, prompt, REEL_ANALYSIS_SCHEMA, { temperature: 0.3, signal })

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
// synthesizeNiche
// ---------------------------------------------------------------------------

/**
 * Synthesize cross-creator niche insights from an array of PerCreatorSummary objects.
 *
 * Returns top hook patterns, benchmarks, and actionable replicate/avoid tips.
 */
export async function synthesizeNiche(
  summaries: PerCreatorSummary[],
  geminiKey: string,
  benchmarks: SynthesisOutput['benchmarks'],
  signal?: AbortSignal,
): Promise<SynthesisOutput> {
  const prompt = buildSynthesisPrompt(summaries)

  // Gemini returns ONLY the qualitative synthesis; benchmarks are computed in code (M5).
  const raw = await callGeminiWithSchema<{
    topPatterns?: Array<{ archetype?: string; count?: number; example?: string }>
    replicateTips?: string[]
    avoidTips?: string[]
  }>(geminiKey, prompt, SYNTHESIS_SCHEMA, { temperature: 0.4, signal })

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
