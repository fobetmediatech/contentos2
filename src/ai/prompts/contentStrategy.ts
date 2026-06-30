/**
 * Content Strategy synthesis — prompt + JSON schema + guard.
 *
 * Combines the onboarding brief (business context the backend can't scrape) with the backend
 * analysis (competitor metrics + per-creator HookMap summaries) and asks Gemini to produce a
 * structured, client-ready content strategy that drives toward the client's offer — while
 * honouring the language preference and the dislike/off-limits guardrails.
 */
import type { StrategyBrief, ContentStrategyDoc, AnalyzedAccount } from '../../domain/strategy'
import type { CreatorHookSummary } from './creatorHookSummary'

export const CONTENT_STRATEGY_PROMPT_VERSION = 1

const LANGUAGE_RULE: Record<StrategyBrief['language'], string> = {
  english: 'Write all hooks/ideas in English.',
  hindi: 'Write all hooks/ideas in Hindi, but in LATIN script (romanised) — never Devanagari.',
  hinglish: 'Write all hooks/ideas in Hinglish (natural Hindi+English mix), in LATIN script only — never Devanagari.',
}

export const CONTENT_STRATEGY_SCHEMA = {
  type: 'object',
  properties: {
    positioning: { type: 'string' },
    audienceInsight: { type: 'string' },
    competitiveSummary: { type: 'string' },
    whatsWorking: { type: 'array', items: { type: 'string' } },
    contentPillars: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name', 'description'] },
    },
    hookFormulas: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, template: { type: 'string' }, example: { type: 'string' } }, required: ['name', 'template', 'example'] },
    },
    contentIdeas: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, hook: { type: 'string' }, format: { type: 'string' }, pillar: { type: 'string' } }, required: ['title', 'hook', 'format', 'pillar'] },
    },
    formatMix: {
      type: 'array',
      items: { type: 'object', properties: { format: { type: 'string' }, weight: { type: 'string' }, rationale: { type: 'string' } }, required: ['format', 'weight', 'rationale'] },
    },
    cadence: { type: 'object', properties: { postsPerWeek: { type: 'string' }, notes: { type: 'string' } }, required: ['postsPerWeek', 'notes'] },
    voiceAndTone: { type: 'string' },
    dos: { type: 'array', items: { type: 'string' } },
    donts: { type: 'array', items: { type: 'string' } },
  },
  required: ['positioning', 'audienceInsight', 'competitiveSummary', 'whatsWorking', 'contentPillars', 'hookFormulas', 'contentIdeas', 'formatMix', 'cadence', 'voiceAndTone', 'dos', 'donts'],
}

function accountsBlock(accounts: AnalyzedAccount[]): string {
  if (!accounts.length) return '(no competitor accounts analysed)'
  return accounts
    .map((a) => {
      const er = a.engagementRate != null ? `${a.engagementRate.toFixed(2)}%` : 'N/A'
      return `- @${a.username} (${a.fullName || '—'}) | ${a.source} | ${a.followers.toLocaleString()} followers | ER ${er}${a.verified ? ' | verified' : ''}`
    })
    .join('\n')
}

function hookBlock(summaries: CreatorHookSummary[]): string {
  if (!summaries.length) return '(no hook analysis available)'
  return summaries
    .map((s) => {
      const hooks = s.dominantHooks.slice(0, 5).map((h) => `    • ${h.pattern} (x${h.count}) — e.g. "${h.example}"`).join('\n')
      const works = s.whatConsistentlyWorks.slice(0, 5).map((w) => `    • ${w}`).join('\n')
      const tpl = s.replicableTemplates.slice(0, 5).map((t) => `    • ${t}`).join('\n')
      return `### @${s.handle} (${s.reelCount} reels; median ${s.benchmarks.medianViews.toLocaleString()} views)
  Dominant hooks:\n${hooks || '    • —'}
  What consistently works:\n${works || '    • —'}
  Replicable templates:\n${tpl || '    • —'}`
    })
    .join('\n\n')
}

export function buildContentStrategyPrompt(
  brief: StrategyBrief,
  accounts: AnalyzedAccount[],
  hookSummaries: CreatorHookSummary[],
): string {
  const dislikes = brief.dislikes.trim() || '(none specified)'
  const offLimits = brief.offLimits.trim() || '(none specified)'
  return `You are a senior Instagram content strategist at a creator agency. Produce a complete,
client-ready CONTENT STRATEGY for the client below, grounded in the competitor analysis provided.

# CLIENT BRIEF (business context — the source of truth)
- Brand / on-screen name: ${brief.brandName}
- Primary niche: ${brief.primaryNiche}
- Sub-niche / speciality: ${brief.subNiche}
- THE OFFER (everything must ultimately drive here): ${brief.offer}
- Target audience: ${brief.audience}

# HARD CONSTRAINTS (never violate)
- Language: ${LANGUAGE_RULE[brief.language]}
- The client DISLIKES: ${dislikes}
- OFF-LIMITS (never produce content touching these): ${offLimits}

# COMPETITIVE LANDSCAPE (scraped + ranked by ContentOS — metrics)
${accountsBlock(accounts)}

# WHAT IS WORKING IN THIS NICHE (HookMap analysis of the accounts above)
${hookBlock(hookSummaries)}

# YOUR TASK
Synthesise the brief + the analysis into a strategy that wins in THIS niche and drives toward THE OFFER.
Return JSON matching the schema with:
- positioning: one sharp sentence on how this brand should be positioned vs. the competitors.
- audienceInsight: what this specific audience actually wants/fears, beyond the surface ask.
- competitiveSummary: 2-3 sentences on the competitive landscape and the gap this brand can own.
- whatsWorking: 4-6 short bullets distilling the winning hook/content patterns from the HookMap analysis above. CRITICAL: write these in LATIN script only (romanise any Hindi/Devanagari source quotes into Latin Hinglish, e.g. "पर मैं आपसे क्यों लूं" → "Par main aapse kyun lun") — never output Devanagari.
- contentPillars: 3-5 recurring content themes (name + description) that map to the offer.
- hookFormulas: 4-6 reusable hook templates DERIVED FROM what works above, each with a fill-in template and a concrete example written for THIS client.
- contentIdeas: 6-10 specific post ideas (title + ready hook + format like Reel/Carousel/Story + which pillar). Hooks must obey the language rule.
- formatMix: recommended split across formats (format + rough weight like "50%" + why), informed by what performs in the analysis.
- cadence: posts per week + notes on timing/sequencing.
- voiceAndTone: how this brand should sound (reflect the aspirational accounts' style, the language, and the dislikes).
- dos / donts: concrete guardrails — fold in the dislikes and off-limits explicitly.

Be specific and tactical, not generic. Every hook/idea must respect the language rule and never touch the off-limits topics. Return ONLY the JSON.`
}

/** Guard raw LLM output into a safe ContentStrategyDoc (mirrors the other prompt guards). */
export function parseContentStrategyDoc(raw: unknown): ContentStrategyDoc {
  const r = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const objArr = <T>(v: unknown, map: (o: Record<string, unknown>) => T): T[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object').map(map) : []
  const cadence = (r.cadence ?? {}) as Record<string, unknown>
  return {
    positioning: str(r.positioning),
    audienceInsight: str(r.audienceInsight),
    competitiveSummary: str(r.competitiveSummary),
    whatsWorking: strArr(r.whatsWorking),
    contentPillars: objArr(r.contentPillars, (o) => ({ name: str(o.name), description: str(o.description) })),
    hookFormulas: objArr(r.hookFormulas, (o) => ({ name: str(o.name), template: str(o.template), example: str(o.example) })),
    contentIdeas: objArr(r.contentIdeas, (o) => ({ title: str(o.title), hook: str(o.hook), format: str(o.format), pillar: str(o.pillar) })),
    formatMix: objArr(r.formatMix, (o) => ({ format: str(o.format), weight: str(o.weight), rationale: str(o.rationale) })),
    cadence: { postsPerWeek: str(cadence.postsPerWeek), notes: str(cadence.notes) },
    voiceAndTone: str(r.voiceAndTone),
    dos: strArr(r.dos),
    donts: strArr(r.donts),
  }
}
