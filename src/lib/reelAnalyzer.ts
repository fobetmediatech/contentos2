/**
 * Reel Analyzer — orchestrates per-reel AI classification and cross-creator synthesis.
 *
 * Two main exports:
 *   analyzeReel       — classify a single reel via Gemini (hook archetype, retention, psychology)
 *   synthesizeNiche   — synthesize cross-creator niche insights from per-creator summaries
 *
 * Plus a helper:
 *   buildPerCreatorSummary — compute PerCreatorSummary from completed analyses + reel data
 */

import { callGeminiWithSchema } from '../ai/gemini'
import { buildReelAnalysisPrompt, REEL_ANALYSIS_SCHEMA, buildSynthesisPrompt, SYNTHESIS_SCHEMA } from '../ai/prompts/reelAnalysis'
import type { ReelData, ReelAnalysis, PerCreatorSummary, SynthesisOutput } from '../store/reelAnalysisStore'

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
