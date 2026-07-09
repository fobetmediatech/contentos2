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
    clientUnderstanding: { type: 'string' },
    currentMarketingFlaw: { type: 'string' },
    categoryTension: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' } },
      },
      required: ['headline', 'bullets'],
    },
    benchmarks: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, metric: { type: 'string' }, lesson: { type: 'string' } }, required: ['name', 'metric', 'lesson'] },
    },
    heroHubHygiene: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          description: { type: 'string' },
          examples: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'role', 'description', 'examples'],
      },
    },
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
    executionRoadmap: {
      type: 'array',
      items: { type: 'object', properties: { phase: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } }, required: ['phase', 'title', 'description'] },
    },
    creatorFirstFormats: { type: 'array', items: { type: 'string' } },
    operatingRhythm: { type: 'array', items: { type: 'string' } },
    kpiFramework: {
      type: 'object',
      properties: {
        leading: { type: 'array', items: { type: 'string' } },
        mid: { type: 'array', items: { type: 'string' } },
        lag: { type: 'array', items: { type: 'string' } },
      },
      required: ['leading', 'mid', 'lag'],
    },
    successGoals: {
      type: 'array',
      items: { type: 'object', properties: { metric: { type: 'string' }, target: { type: 'string' } }, required: ['metric', 'target'] },
    },
    monthlyDeliverables: {
      type: 'array',
      items: { type: 'object', properties: { platform: { type: 'string' }, format: { type: 'string' }, frequency: { type: 'string' } }, required: ['platform', 'format', 'frequency'] },
    },
    teamSystem: {
      type: 'array',
      items: { type: 'object', properties: { role: { type: 'string' }, responsibility: { type: 'string' } }, required: ['role', 'responsibility'] },
    },
    commercials: {
      type: 'object',
      properties: {
        monthlyRetainer: { type: 'string' },
        lineItems: {
          type: 'array',
          items: { type: 'object', properties: { label: { type: 'string' }, amount: { type: 'string' } }, required: ['label', 'amount'] },
        },
        longTermValue: { type: 'array', items: { type: 'string' } },
      },
      required: ['monthlyRetainer', 'lineItems', 'longTermValue'],
    },
    voiceAndTone: { type: 'string' },
    dos: { type: 'array', items: { type: 'string' } },
    donts: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'positioning', 'audienceInsight', 'competitiveSummary', 'clientUnderstanding',
    'currentMarketingFlaw', 'categoryTension', 'benchmarks', 'heroHubHygiene',
    'whatsWorking', 'contentPillars', 'hookFormulas', 'contentIdeas', 'formatMix',
    'cadence', 'executionRoadmap', 'creatorFirstFormats', 'operatingRhythm',
    'kpiFramework', 'successGoals', 'monthlyDeliverables', 'teamSystem',
    'commercials', 'voiceAndTone', 'dos', 'donts',
  ],
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
Produce a client-ready PROPOSAL-STYLE STRATEGY DECK inspired by agency decks like the Fobet/Lirunex
proposal: first prove we understand the client, then diagnose the category, then present the content
system, execution plan, measurement plan, deliverables, team system, and commercials.

In addition to the original strategy fields, fill these proposal fields:
- clientUnderstanding: a concise "what we understand of you" paragraph grounded in the brief.
- currentMarketingFlaw: a punchy diagnosis of what is likely wrong with the brand's current social presence. Do not invent facts; frame as category/positioning risk when current data is unknown.
- categoryTension: headline + 3-4 bullets naming the emotional or market tension that creates the content opportunity.
- benchmarks: 2-4 benchmark accounts/brands from the analyzed accounts or well-known adjacent examples; each must include a metric/scale signal and the lesson.
- heroHubHygiene: exactly 3 rows named Hero, Hub, Hygiene. Explain WHAT/WHY, WHEN, and HOW content for this client. Include 2-4 example content angles in each.
- executionRoadmap: 3-4 phases such as Strategy & Governance, Creative & Production, Publishing & Optimisation, Review & Iteration.
- creatorFirstFormats: 5-7 concrete formats the client can expect (talking head, stitch/reaction, POV, mixed-media VO, carousel, etc.).
- operatingRhythm: 4-6 bullets describing weekly/monthly review, calendar, testing, pruning, and doubling down.
- kpiFramework: leading/mid/lag indicators. Leading = discovery/reach; mid = engagement/private intent; lag = momentum/revenue proxy.
- successGoals: 4-6 measurable six-month goals. Use sensible targets based on the niche and account scale; avoid impossible guarantees.
- monthlyDeliverables: platform/format/frequency rows for the proposal. Keep frequencies realistic and editable.
- teamSystem: 4-6 roles with responsibilities for executing this plan.
- commercials: monthlyRetainer can be "To be discussed" unless pricing is explicit in the brief; lineItems should be editable proposal placeholders; longTermValue should sell the durable strategic value.

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
  const categoryTension = (r.categoryTension ?? {}) as Record<string, unknown>
  const kpiFramework = (r.kpiFramework ?? {}) as Record<string, unknown>
  const commercials = (r.commercials ?? {}) as Record<string, unknown>
  return {
    positioning: str(r.positioning),
    audienceInsight: str(r.audienceInsight),
    competitiveSummary: str(r.competitiveSummary),
    clientUnderstanding: str(r.clientUnderstanding),
    currentMarketingFlaw: str(r.currentMarketingFlaw),
    categoryTension: { headline: str(categoryTension.headline), bullets: strArr(categoryTension.bullets) },
    benchmarks: objArr(r.benchmarks, (o) => ({ name: str(o.name), metric: str(o.metric), lesson: str(o.lesson) })),
    heroHubHygiene: objArr(r.heroHubHygiene, (o) => ({ name: str(o.name), role: str(o.role), description: str(o.description), examples: strArr(o.examples) })),
    whatsWorking: strArr(r.whatsWorking),
    contentPillars: objArr(r.contentPillars, (o) => ({ name: str(o.name), description: str(o.description) })),
    hookFormulas: objArr(r.hookFormulas, (o) => ({ name: str(o.name), template: str(o.template), example: str(o.example) })),
    contentIdeas: objArr(r.contentIdeas, (o) => ({ title: str(o.title), hook: str(o.hook), format: str(o.format), pillar: str(o.pillar) })),
    formatMix: objArr(r.formatMix, (o) => ({ format: str(o.format), weight: str(o.weight), rationale: str(o.rationale) })),
    cadence: { postsPerWeek: str(cadence.postsPerWeek), notes: str(cadence.notes) },
    executionRoadmap: objArr(r.executionRoadmap, (o) => ({ phase: str(o.phase), title: str(o.title), description: str(o.description) })),
    creatorFirstFormats: strArr(r.creatorFirstFormats),
    operatingRhythm: strArr(r.operatingRhythm),
    kpiFramework: { leading: strArr(kpiFramework.leading), mid: strArr(kpiFramework.mid), lag: strArr(kpiFramework.lag) },
    successGoals: objArr(r.successGoals, (o) => ({ metric: str(o.metric), target: str(o.target) })),
    monthlyDeliverables: objArr(r.monthlyDeliverables, (o) => ({ platform: str(o.platform), format: str(o.format), frequency: str(o.frequency) })),
    teamSystem: objArr(r.teamSystem, (o) => ({ role: str(o.role), responsibility: str(o.responsibility) })),
    commercials: {
      monthlyRetainer: str(commercials.monthlyRetainer),
      lineItems: objArr(commercials.lineItems, (o) => ({ label: str(o.label), amount: str(o.amount) })),
      longTermValue: strArr(commercials.longTermValue),
    },
    voiceAndTone: str(r.voiceAndTone),
    dos: strArr(r.dos),
    donts: strArr(r.donts),
  }
}
