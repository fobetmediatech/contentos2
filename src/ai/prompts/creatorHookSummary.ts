/**
 * Creator Hook Summary — prompts + JSON schema for context-safe creator-level synthesis.
 *
 * A single-`@handle` profile run produces ~10 per-reel HookMap case studies. This module
 * provides the MAP and REDUCE prompts (+ shared responseSchema) used by
 * `synthesizeCreatorHooks` (src/lib/reelAnalyzer.ts) to collapse those case studies into
 * ONE creator-level summary — token-budgeting the input and falling back to map-reduce so
 * a large profile never overflows the model's context.
 *
 *   MAP    — summarize one chunk of reel digests into a partial creator summary.
 *   REDUCE — combine several partial summaries into one final creator summary.
 *
 * Benchmarks (medianViews/medianLikes/commentsLikesRatio) are computed in CODE, not by the
 * LLM (mirrors computeBenchmarks), so they are NOT part of the schema below.
 */

/** Bump when the prompt or schema changes materially. */
export const CREATOR_HOOK_SUMMARY_PROMPT_VERSION = 1

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface CreatorHookSummary {
  handle: string
  reelCount: number
  dominantHooks: Array<{ pattern: string; count: number; example: string }>
  recurringOpenings: string[]
  whatConsistentlyWorks: string[]
  replicableTemplates: string[]
  narrative: string
  benchmarks: { medianViews: number; medianLikes: number; commentsLikesRatio: number }
}

/** The qualitative half the LLM produces — benchmarks/handle/reelCount are attached in code. */
export type CreatorHookSummaryDraft = Omit<CreatorHookSummary, 'handle' | 'reelCount' | 'benchmarks'>

// ---------------------------------------------------------------------------
// JSON Schema (shared by MAP and REDUCE — both return the same qualitative shape)
// ---------------------------------------------------------------------------

export const CREATOR_HOOK_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    dominantHooks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          count: { type: 'integer' },
          example: { type: 'string' },
        },
        required: ['pattern', 'count', 'example'],
      },
    },
    recurringOpenings: { type: 'array', items: { type: 'string' } },
    whatConsistentlyWorks: { type: 'array', items: { type: 'string' } },
    replicableTemplates: { type: 'array', items: { type: 'string' } },
    narrative: { type: 'string' },
    // benchmarks are computed in code from real reel metrics — NOT asked of the LLM.
  },
  required: ['dominantHooks', 'recurringOpenings', 'whatConsistentlyWorks', 'replicableTemplates', 'narrative'],
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * MAP prompt — summarize one chunk of per-reel digests into a partial creator summary.
 *
 * Each digest already condenses one reel (hook opening, video signals, metrics) so the
 * prompt stays well inside budget. The output is the same qualitative shape as the final
 * summary, but scoped to just this chunk's reels.
 */
export function buildMapPrompt(handle: string, digestTexts: string[]): string {
  const digestsBlock = digestTexts.map((t, i) => `### Reel ${i + 1}\n${t}`).join('\n\n')

  return `You are an expert Instagram content strategist analysing one creator's hooks.

## Task

Below are condensed digests of reels from ${handle}. Summarise the HOOK patterns across THIS
set of reels into a partial creator profile:

1. **dominantHooks** — the recurring hook patterns in this set, each with a \`count\` of how
   many reels use it and a short verbatim/representative \`example\` opening line.
2. **recurringOpenings** — opening phrasings or structures that show up more than once.
3. **whatConsistentlyWorks** — concrete tactics that consistently correlate with the stronger
   reels in this set (reference the metrics in the digests).
4. **replicableTemplates** — fill-in-the-blank hook templates another creator could adapt.
5. **narrative** — 2-3 sentences describing this creator's hook style across these reels.

Do NOT compute numeric view/like/comment benchmarks — those are calculated separately from raw
metrics. Focus only on the qualitative pattern recognition.

## Reel Digests

${digestsBlock}

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}

/**
 * REDUCE prompt — combine several partial creator summaries into ONE final summary.
 *
 * The word "REDUCE" appears in the heading both as documentation and as a stable marker
 * the orchestrator/tests can use to distinguish a reduce call from a map call.
 */
export function buildReducePrompt(handle: string, partials: CreatorHookSummaryDraft[]): string {
  const partialsJson = JSON.stringify(partials, null, 2)

  return `You are an expert Instagram content strategist performing a REDUCE step.

## Task

Below are several PARTIAL hook summaries for ${handle}, each covering a different subset of the
creator's reels. Merge them into ONE coherent creator-level summary:

1. **dominantHooks** — consolidate overlapping patterns across the partials; SUM their counts
   for the same pattern; keep the single best \`example\` for each. Order by count, descending.
2. **recurringOpenings** — the union of distinct recurring openings (de-duplicated).
3. **whatConsistentlyWorks** — the strongest, de-duplicated tactics across all partials.
4. **replicableTemplates** — the most reusable, de-duplicated templates.
5. **narrative** — 2-3 sentences synthesising this creator's overall hook style.

Do NOT compute numeric benchmarks — those are calculated separately from raw metrics.

## Partial Summaries (JSON)

\`\`\`json
${partialsJson}
\`\`\`

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}

// ---------------------------------------------------------------------------
// Output guard
// ---------------------------------------------------------------------------

/**
 * Coerce/guard raw LLM output into a CreatorHookSummaryDraft so a missing or mistyped field
 * can't crash downstream code (mirrors synthesizeNiche's Array.isArray guards). Benchmarks,
 * handle, and reelCount are attached by the caller (computed in code), not parsed here.
 */
export function parseCreatorHookSummaryDraft(raw: unknown): CreatorHookSummaryDraft {
  const r = (raw ?? {}) as Record<string, unknown>
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  const dominantHooks = Array.isArray(r.dominantHooks)
    ? (r.dominantHooks as unknown[])
        .filter((h): h is Record<string, unknown> => !!h && typeof (h as Record<string, unknown>).pattern === 'string')
        .map((h) => ({
          pattern: h.pattern as string,
          count: Number(h.count) || 0,
          example: typeof h.example === 'string' ? h.example : '',
        }))
    : []

  return {
    dominantHooks,
    recurringOpenings: strArr(r.recurringOpenings),
    whatConsistentlyWorks: strArr(r.whatConsistentlyWorks),
    replicableTemplates: strArr(r.replicableTemplates),
    narrative: typeof r.narrative === 'string' ? r.narrative : '',
  }
}

/**
 * Build the full CreatorHookSummary from an LLM draft plus the code-computed pieces.
 */
export function parseCreatorHookSummary(
  raw: unknown,
  handle: string,
  reelCount: number,
  benchmarks: CreatorHookSummary['benchmarks'],
): CreatorHookSummary {
  return { handle, reelCount, ...parseCreatorHookSummaryDraft(raw), benchmarks }
}
