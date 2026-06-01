/**
 * Reel Analysis — Hook taxonomy constants, JSON schemas, and prompt builders.
 *
 * Used by the reel-analysis pipeline to:
 *  1. Classify individual reels against the hook archetype taxonomy (REEL_ANALYSIS_SCHEMA)
 *  2. Synthesize cross-creator niche insights (SYNTHESIS_SCHEMA)
 */

// ---------------------------------------------------------------------------
// Hook archetype taxonomy
// ---------------------------------------------------------------------------

export const HOOK_ARCHETYPES = [
  'Curiosity gap',
  'Contrarian claim',
  'Sunk-cost / identity threat',
  'Visual shock',
  'Direct callout',
  'Demo-first',
  'Story cold-open',
  'Question bait',
  'Authority / bandwagon FOMO',
] as const

export type HookArchetype = (typeof HOOK_ARCHETYPES)[number]

// ---------------------------------------------------------------------------
// JSON Schema: per-reel analysis (used with callGeminiWithSchema)
// ---------------------------------------------------------------------------

export const REEL_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    hookArchetype: {
      type: 'string',
      enum: [...HOOK_ARCHETYPES], // ENUM not free-text — prevents synthesis count breaks
    },
    secondaryArchetype: {
      type: 'string',
      enum: [...HOOK_ARCHETYPES],
    },
    retentionMechanism: { type: 'string' },
    psychologyTrigger: { type: 'string' },
    replicationTemplate: { type: 'string' },
    lowConfidenceNote: { type: 'string' },
    // commentsLikesRatio is NOT here — computed client-side
  },
  required: ['hookArchetype', 'retentionMechanism', 'psychologyTrigger', 'replicationTemplate'],
}

// ---------------------------------------------------------------------------
// JSON Schema: cross-creator synthesis (used with synthesizeNiche)
// ---------------------------------------------------------------------------

export const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    topPatterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          archetype: { type: 'string' },
          count: { type: 'integer' },
          example: { type: 'string' },
        },
        required: ['archetype', 'count', 'example'],
      },
    },
    benchmarks: {
      type: 'object',
      properties: {
        medianViews: { type: 'number' },
        likesViewsRatio: { type: 'number' },
        commentsLikesRatio: { type: 'number' },
      },
      required: ['medianViews', 'likesViewsRatio', 'commentsLikesRatio'],
    },
    replicateTips: { type: 'array', items: { type: 'string' } },
    avoidTips: { type: 'array', items: { type: 'string' } },
  },
  required: ['topPatterns', 'benchmarks', 'replicateTips', 'avoidTips'],
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const HOOK_TAXONOMY_TABLE = `
| Archetype                    | Description                                                              |
|------------------------------|--------------------------------------------------------------------------|
| Curiosity gap                | Withholds key information to create irresistible need to know more       |
| Contrarian claim             | Opens with a statement that contradicts common belief                    |
| Sunk-cost / identity threat  | Makes the viewer feel their identity or past decisions are at stake      |
| Visual shock                 | Extreme or unexpected visual that demands attention before the brain can filter |
| Direct callout               | Explicitly addresses the viewer's role, job, or situation ("If you're a…") |
| Demo-first                   | Leads with a tangible transformation or result before any explanation    |
| Story cold-open              | Drops into the middle of a narrative scene in progress                   |
| Question bait                | Opens with a question the viewer must answer to feel smart or safe       |
| Authority / bandwagon FOMO   | Anchors to social proof, expert status, or "everyone else already knows" |
`.trim()

/**
 * Build the per-reel analysis prompt.
 * Injects the hook taxonomy table as context and instructs Gemini to
 * classify the hook archetype from the provided enum values.
 */
export function buildReelAnalysisPrompt(reel: {
  caption: string
  videoViewCount: number
  likesCount: number
  commentsCount: number
  hashtags: string[]
  videoDuration: number
  musicInfo?: unknown
}): string {
  const reelJson = JSON.stringify(
    {
      caption: reel.caption,
      videoViewCount: reel.videoViewCount,
      likesCount: reel.likesCount,
      commentsCount: reel.commentsCount,
      hashtags: reel.hashtags,
      videoDurationSeconds: reel.videoDuration,
      musicInfo: reel.musicInfo ?? null,
    },
    null,
    2,
  )

  return `You are an expert Instagram content strategist specialising in viral hook mechanics.

## Hook Archetype Taxonomy

${HOOK_TAXONOMY_TABLE}

## Task

Analyse the reel data below and return a structured classification.

**Rules:**
- \`hookArchetype\` MUST be one of the exact enum values in the taxonomy above.
- \`secondaryArchetype\` is optional — only populate if a second archetype is clearly present.
- \`retentionMechanism\`: Explain in one sentence what keeps viewers watching past the hook.
- \`psychologyTrigger\`: Name the core psychological driver (e.g. FOMO, identity, curiosity, social proof).
- \`replicationTemplate\`: Provide a fill-in-the-blank hook sentence a creator could adapt.
- \`lowConfidenceNote\`: Set this field when classifying "Visual shock" or "Demo-first" — these archetypes
  are inferred from caption/metrics alone without seeing the actual video; flag the limitation briefly.
  Leave empty or omit for other archetypes.

## Reel Data (JSON)

\`\`\`json
${reelJson}
\`\`\`

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}

/**
 * Build the cross-creator niche synthesis prompt.
 * Expects per-creator summaries and returns top patterns, benchmarks, and
 * actionable tips aligned with SYNTHESIS_SCHEMA.
 */
export function buildSynthesisPrompt(
  summaries: Array<{
    handle: string
    dominantArchetype: string
    secondDominantArchetype?: string
    topReelViews: number
    medianViews: number
    commentsLikesRatios: number[]
    reelCount: number
  }>,
): string {
  const summariesJson = JSON.stringify(summaries, null, 2)

  return `You are an expert Instagram content strategist performing cross-creator niche synthesis.

## Task

Given the per-creator reel summaries below, synthesise niche-level insights:

1. **Top 3 hook patterns** — identify the 3 most frequent archetypes across all creators,
   with a count of how many creator summaries feature that archetype as dominant or second-dominant,
   and a short example hook sentence for each.

2. **Benchmarks** — compute from all creators combined:
   - \`medianViews\`: median of all per-creator medianViews values
   - \`likesViewsRatio\`: average of (topReelViews-normalised likes proxy; use medianViews if topReelViews unavailable)
     — compute as mean of (likesCount / views) across creators where possible; otherwise estimate from
     the distribution in the data
   - \`commentsLikesRatio\`: compute as mean across all commentsLikesRatios arrays flattened

3. **3 replicate tips** — concrete, actionable advice for a new creator entering this niche.

4. **2 avoid tips** — patterns or mistakes that appear to correlate with low performance in this data.

## Per-Creator Summaries (JSON)

\`\`\`json
${summariesJson}
\`\`\`

Return only valid JSON matching the synthesis schema. Do not add commentary outside the JSON.`
}
