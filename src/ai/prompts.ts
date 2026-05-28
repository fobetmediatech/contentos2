/**
 * Gemini prompt templates.
 *
 * COMPETITOR_CATEGORIES is injected at runtime (UC3).
 * Changing categories.ts changes AI taxonomy language + UI labels in one edit.
 *
 * Discovery prompts use a niche-agnostic schema with:
 *   specialties: string[]  — what specific sub-topics this creator covers
 *   contentFocus: string   — their primary content format
 *   partnershipReady: boolean — bio has contact/collab/DM signals
 *   locationConfidence: 'confirmed' | 'likely' | 'unknown' — how sure we are they're in the city
 */

import { COMPETITOR_CATEGORIES, DISCOVERY_CATEGORIES } from '../shared/utils/categories'
import type { NormalizedProfile } from '../lib/transformers'

export interface CompetitorAnalysisResult {
  username: string
  category: 'top' | 'trending'
  rank: number
  rationale: string
}

export interface AnalysisOutput {
  competitors: CompetitorAnalysisResult[]
  niche: string
  summary: string
  /** Sub-niche derived from reference accounts — debug field, not surfaced in UI */
  derivedNiche?: string
}

/**
 * Build the competitor classification prompt.
 * Taxonomy language comes entirely from COMPETITOR_CATEGORIES — not hardcoded.
 *
 * @param nicheContext  Strategist-provided niche description (optional). When present it is
 *                      injected as an EXPLICIT NICHE CONTEXT block that overrides hashtag inference.
 */
export function buildCompetitorPrompt(
  inputProfiles: NormalizedProfile[],
  candidates: NormalizedProfile[],
  nicheContext?: string,
): string {
  const topCategory = COMPETITOR_CATEGORIES.top
  const trendingCategory = COMPETITOR_CATEGORIES.trending

  const inputSummary = inputProfiles
    .map(
      (p) =>
        `@${p.username} (${p.followersCount.toLocaleString()} followers, ER: ${p.engagementRate?.toFixed(2) ?? 'N/A'}%, bio: "${p.biography.slice(0, 100)}")`,
    )
    .join('\n')

  const candidateSummary = candidates
    .map((p) => {
      const er = p.engagementRate?.toFixed(2) ?? 'N/A'
      // Pre-classify large established accounts. Accounts with 500K+ followers are
      // established players regardless of ER — a code-level label prevents Gemini
      // from classifying them as Trending based on ER alone.
      const establishedLabel = p.followersCount > 500_000
        ? ' [ESTABLISHED: 500K+ followers — assign to Top category]'
        : ''
      return `@${p.username} | followers: ${p.followersCount.toLocaleString()} | ER: ${er}% | posts: ${p.postsCount} | verified: ${p.verified} | bio: "${p.biography.replace(/[\n\r]/g, ' ').slice(0, 120)}"${establishedLabel}`
    })
    .join('\n')

  // Strategist-provided niche description (highest-priority signal — human knowledge).
  const trimmedNicheContext = nicheContext?.trim() ?? ''
  const nicheContextSection = trimmedNicheContext
    ? `\nEXPLICIT NICHE CONTEXT (provided by the strategist — treat this as the definitive niche description):\n${trimmedNicheContext}\n`
    : ''

  // Collect and deduplicate hashtags across all input profiles.
  // Only input profiles' hashtags are used as niche signals — candidate hashtags
  // are ignored here and left to Gemini's own judgment.
  const allHashtags = inputProfiles.flatMap((p) => p.topHashtags)
  const uniqueHashtags = [...new Set(allHashtags)]
  const nicheSignalsSection = uniqueHashtags.length > 0
    ? `\nNICHE SIGNALS (extracted from reference accounts' recent posts — their own hashtag usage):\n${uniqueHashtags.join(', ')}\n`
    : ''

  // Count instruction: use "up to" whenever any filtering signal is available
  // (strategist context OR hashtag signals), so Gemini can legitimately exclude
  // wrong-niche accounts. Without any signals, force "exactly" so Gemini doesn't
  // return fewer accounts simply because it has no filter criterion to apply.
  const hasFilterSignal = trimmedNicheContext.length > 0 || uniqueHashtags.length > 0
  const countInstruction = hasFilterSignal ? 'up to' : 'exactly'

  // Injected when filter signals exist — forces Gemini to derive the specific sub-niche
  // from the reference accounts before evaluating candidates. Anchors chain-of-thought
  // in the output via the "derivedNiche" JSON field so strict JSON-output pressure
  // doesn't cause the model to skip the derivation step silently.
  const nicheDeriveBlock = hasFilterSignal
    ? `\nNICHE DERIVATION — complete this before evaluating candidates:
1. From the reference accounts' bios and hashtags above, identify the SPECIFIC sub-niche they represent.
   "Business" could mean entrepreneurship, finance/trading, corporate leadership, or SME content — the reference accounts tell you which.
2. This derived sub-niche overrides the raw niche keyword. If reference accounts are entrepreneurship creators, finance/trading/investing accounts are NOT relevant for this search.
3. Include an account if its primary focus is within the derived sub-niche. Accounts whose content meaningfully spans both the derived sub-niche AND an adjacent sub-niche (e.g. an entrepreneur who also covers investing, when the reference accounts themselves cover both) should be included.
Populate the "derivedNiche" field in your JSON output with the sub-niche you identified.\n`
    : ''

  return `You are an Instagram competitive intelligence analyst for a social media agency.

REFERENCE ACCOUNTS (the client's handles or known competitors in their niche):
${inputSummary}
${nicheContextSection}${nicheSignalsSection}${nicheDeriveBlock}
YOUR TASK:
Analyze the candidate accounts below and select ${countInstruction}:
- 5 "${topCategory.label}" competitors: ${topCategory.taxonomy}
- 5 "${trendingCategory.label}" competitors: ${trendingCategory.taxonomy}

CANDIDATE ACCOUNTS:
${candidateSummary}

SELECTION CRITERIA:
- FIRST: Check niche relevance. If EXPLICIT NICHE CONTEXT is provided above, treat it as the definitive niche boundary. When the niche is a PROFESSION (e.g. "marketing education", "productivity coaching", "content strategy"), accounts whose PRIMARY focus is a TOOL CATEGORY adjacent to that profession (e.g. "AI tools reviews", "tech news", "coding tutorials") are NOT niche-relevant — even if that tool is used by the profession. Include an account only if its primary content IS the profession itself, not just the tools. If only NICHE SIGNALS are provided, apply the same distinction. Borderline accounts whose content is clearly about the profession topic (even if they sometimes cover tools) should be included.
- GOAL: Fill both categories as completely as possible. Aim for 5 in each. Only reduce the count if there are genuinely not enough niche-relevant candidates — do not leave slots empty out of excessive strictness.
- For Top 5: prioritize follower count, brand authority, posting consistency, and verified status. Accounts with the [ESTABLISHED: 500K+ followers] label MUST be assigned to Top, not Trending.
- For Trending 5: prioritize engagement rate (ER %) relative to follower tier — accounts in their growth phase where ER significantly exceeds peers at the same follower count.
- When a candidate could qualify for either category (mid-tier account with decent followers AND high ER), prefer Trending if the account has under 500K followers.
- If a candidate fits both Top and Trending criteria, assign it to whichever category has fewer entries.

OUTPUT FORMAT (respond with valid JSON only, no markdown):
{
  "derivedNiche": "<specific sub-niche derived from the reference accounts, e.g. 'entrepreneurship & startup content' — NOT the raw keyword>",
  "niche": "<2–4 word description of the niche, e.g. 'personal productivity creators' or 'marketing education'>",
  "summary": "<2 sentences: what this niche looks like on Instagram and what competitive dynamics you observed>",
  "competitors": [
    {
      "username": "<handle without @>",
      "category": "${topCategory.id}",
      "rank": 1,
      "rationale": "<1 sentence (max 120 chars) explaining why this account qualifies as ${topCategory.label} in this niche>"
    },
    {
      "username": "<handle without @>",
      "category": "${trendingCategory.id}",
      "rank": 1,
      "rationale": "<1 sentence (max 120 chars) explaining why this account qualifies as ${trendingCategory.label} in this niche>"
    }
  ]
}

Rank within each category starts at 1 (1 = best fit). Return exactly the JSON object, nothing else.`
}

// ----- Discovery types -----

export interface DiscoveryResult {
  username: string
  category: 'top' | 'trending'
  rank: number
  rationale: string
  /** Niche-agnostic specialties — inferred from bio/username (e.g. ["Street Food", "Café Culture"]) */
  specialties: string[]
  /** Primary content format inferred from bio/username */
  contentFocus: string
  /** true if bio contains collab/DM/business/PR/email signals */
  partnershipReady: boolean
  /** Confidence that the creator is actually in the target city */
  locationConfidence: 'confirmed' | 'likely' | 'unknown'
}

export interface DiscoveryOutput {
  results: DiscoveryResult[]
  /** 2–4 word niche label detected by Gemini */
  niche: string
}

// ----- Discovery prompt -----

/**
 * Build the location discovery prompt for Gemini.
 *
 * Selects the 10 most relevant creators from candidates, split Top 5 / Trending 5.
 * Schema is niche-agnostic: specialties + contentFocus replace food-specific fields.
 *
 * @param city         Target city (e.g. "Mumbai")
 * @param niche        Content niche (e.g. "food", "fitness", "travel")
 * @param candidates   Profiles that survived the location filter
 * @param creatorCount Number of creator-scored profiles in the candidate list (optional — for pool composition hint)
 * @param businessCount Number of business profiles in the candidate list (optional)
 */
export function buildDiscoveryPrompt(
  city: string,
  niche: string,
  candidates: NormalizedProfile[],
  creatorCount?: number,
  businessCount?: number,
): string {
  const topCategory = DISCOVERY_CATEGORIES.top
  const trendingCategory = DISCOVERY_CATEGORIES.trending

  const candidateSummary = candidates
    .map((p) => {
      const er = p.engagementRate?.toFixed(2) ?? 'N/A'
      const accountType = p.isBusinessAccount ? 'business' : 'creator'
      const establishedLabel = p.followersCount > 500_000
        ? ' [ESTABLISHED: 500K+ followers — assign to Top category]'
        : ''
      return `@${p.username} | type: ${accountType} | followers: ${p.followersCount.toLocaleString()} | ER: ${er}% | posts: ${p.postsCount} | verified: ${p.verified} | bio: "${p.biography.replace(/[\n\r]/g, ' ').slice(0, 150)}"${establishedLabel}`
    })
    .join('\n')

  // Pool composition line: only injected when both counts are provided.
  // Gives Gemini grounded info about what's in the list — makes the BALANCE RULE
  // data-driven rather than aspirational.
  const poolCompositionLine = (creatorCount !== undefined && businessCount !== undefined)
    ? `\nCANDIDATE POOL COMPOSITION: ${creatorCount} creator accounts (type: creator) + ${businessCount} business accounts (type: business) in this list.\n`
    : ''

  return `You are a social media analyst specializing in creator discovery for brand partnerships.

TASK: Find the top 10 ${niche}-related Instagram accounts based in ${city} from the list below.
${poolCompositionLine}
ACCOUNT TYPES TO INCLUDE:
1. Content creators / influencers (type: creator) — individuals who post ${niche} content (reviews, vlogs, tutorials, lifestyle)
2. Relevant businesses (type: business) — restaurants, cafés, brands, or establishments operating in the ${niche} space

BALANCE RULE — this is mandatory:
- Across all 10 results, aim for at least 5 content creators (type: creator) and at most 5 businesses (type: business).
- If the niche or context mentions "vlogger", "blogger", or "creator", lean heavier on creators: aim for 6-7 creators out of 10.
- If fewer creator profiles exist than needed to fill 10 slots, fill the remaining slots with the most niche-relevant businesses from the candidate list.
- MINIMUM RESULT COUNT: Always return exactly 10 results. If fewer than 10 candidate profiles appear in this list, return all of them. Never reduce the count.

SELECTION CRITERIA:
- Select any account whose bio or username strongly suggests it is relevant to ${niche}.
- "${topCategory.label}" (Top 5): ${topCategory.taxonomy}
- "${trendingCategory.label}" (Trending 5): ${trendingCategory.taxonomy}
- If fewer than 5 good accounts exist in a category, reduce that category's count rather than padding with off-niche accounts.

CANDIDATE PROFILES:
${candidateSummary}

For EACH selected account, determine:
- specialties: 1–3 specific sub-topics this account covers within ${niche}. Use natural phrases adapted to the account type:
    • Creators: "Street Food Reviews", "Recipe Tutorials", "Café Hopping", "Budget Eats"
    • Businesses: "Fine Dining", "Cloud Kitchen", "Craft Cocktails", "Vegan Menu"
- contentFocus: their single primary format — "Tutorials", "Reviews", "Vlogs", "Lifestyle", "Restaurant", "Brand", or "Mixed"
- partnershipReady: true if bio contains ANY of: "collab", "DM for", "business", "inquiries", "PR", "contact", "@gmail", "@yahoo", "link in bio", "reservations", "catering", or any booking/contact signal
- locationConfidence: "confirmed" if ${city} (or an alias) appears in bio; "likely" if context strongly implies ${city} without the name; "unknown" if only hashtag signal exists

OUTPUT FORMAT (valid JSON only, no markdown):
{
  "niche": "<2–4 word label for this niche, e.g. '${niche} scene' or '${niche} creators'>",
  "results": [
    {
      "username": "<handle without @>",
      "category": "${topCategory.id}",
      "rank": 1,
      "rationale": "<1 sentence, max 120 chars, why this account is a top ${niche} presence in ${city}>",
      "specialties": ["<sub-topic 1>", "<sub-topic 2>"],
      "contentFocus": "<format>",
      "partnershipReady": true,
      "locationConfidence": "confirmed"
    }
  ]
}

Return ONLY the JSON object. Rank starts at 1 within each category (1 = best fit).`
}
