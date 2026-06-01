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

/**
 * Clarification question returned by Gemini after discovery.
 * Shown to the user before the ranking step to confirm niche direction.
 */
export interface ClarificationQuestion {
  question: string
  options: string[]
}

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
 * @param nicheContext          Strategist-provided niche description (optional). When present it is
 *                              injected as an EXPLICIT NICHE CONTEXT block that overrides hashtag inference.
 * @param clarificationAnswer   User's answer from the mid-run clarification card (optional).
 *                              When present and non-empty, injected as USER REFINEMENT to direct ranking.
 */
export function buildCompetitorPrompt(
  inputProfiles: NormalizedProfile[],
  candidates: NormalizedProfile[],
  nicheContext?: string,
  clarificationAnswer?: string,
): string {
  const topCategory = COMPETITOR_CATEGORIES.top
  const trendingCategory = COMPETITOR_CATEGORIES.trending

  const inputSummary = inputProfiles
    .map(
      (p) =>
        `@${p.username} (${p.followersCount.toLocaleString()} followers, ER: ${p.engagementRate?.toFixed(2) ?? 'N/A'}%, bio: "${p.biography.replace(/"/g, '\\"').slice(0, 100)}")`,
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
      // Source label: tells Gemini how this candidate was discovered.
      // CONTENT-NICHE accounts were found by scraping posts using the reference accounts'
      // own hashtags — they are the highest-confidence niche matches.
      // AUDIENCE-ADJACENT accounts were found via Instagram's relatedProfiles (audience overlap) —
      // they may or may not be in the same niche.
      const sourceLabel = p.discoverySource === 'hashtag'
        ? ' [CONTENT-NICHE: posted with reference account hashtags]'
        : p.discoverySource === 'round3'
          ? ' [AUDIENCE-ADJACENT: 2-hop relatedProfiles]'
          : p.discoverySource === 'relatedProfiles'
            ? ' [AUDIENCE-ADJACENT: relatedProfiles]'
            : '' // undefined = input profile (should not appear here, but safe fallback)
      return `@${p.username} | followers: ${p.followersCount.toLocaleString()} | ER: ${er}% | posts: ${p.postsCount} | verified: ${p.verified} | bio: "${p.biography.replace(/[\n\r]/g, ' ').replace(/"/g, '\\"').slice(0, 120)}"${establishedLabel}${sourceLabel}`
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

  // User refinement from the mid-run clarification card (highest-priority signal when present).
  // Empty string means the user clicked "Looks right, proceed as-is" — treat as no refinement.
  // Strip newlines before injecting into prompt to prevent prompt injection via
  // bio-sourced clarification options that contain embedded newlines.
  const trimmedClarificationAnswer = (clarificationAnswer?.replace(/[\n\r]/g, ' ') ?? '').trim()
  const clarificationSection = trimmedClarificationAnswer
    ? `\nUSER REFINEMENT (the strategist selected this direction after seeing the candidate pool):\n"${trimmedClarificationAnswer.replace(/"/g, '\\"')}"\nPrioritize candidates that match this direction. Deprioritize candidates that clearly belong to other sub-niches.\n`
    : ''

  // Count instruction: use "up to" whenever any filtering signal is available
  // (strategist context OR hashtag signals OR user refinement), so Gemini can
  // legitimately exclude wrong-niche accounts. Without any signals, force "exactly"
  // so Gemini doesn't return fewer accounts simply because it has no filter criterion.
  const hasFilterSignal = trimmedNicheContext.length > 0 || uniqueHashtags.length > 0 || trimmedClarificationAnswer.length > 0
  const countInstruction = hasFilterSignal ? 'up to' : 'exactly'

  // Injected when filter signals exist — forces Gemini to (1) derive the specific sub-niche
  // from the reference accounts, and (2) explicitly identify adjacent-but-NOT-target niches
  // before evaluating candidates. The two-step process prevents "business umbrella bleed"
  // where trading/podcast/finance accounts pass the filter because they are broadly "business."
  // Anchors chain-of-thought in the output via the "derivedNiche" JSON field.
  const nicheDeriveBlock = hasFilterSignal
    ? `\nNICHE DERIVATION — complete BOTH steps before evaluating candidates:
STEP 1 — Derive the specific sub-niche from the reference accounts' bios and hashtags:
   "Business" could mean entrepreneurship, finance/trading, corporate leadership, or SME content — the reference accounts tell you which.
   Aim for precision: "entrepreneurship & startup content" beats "business".

STEP 2 — Identify 2–3 ADJACENT-BUT-NOT-TARGET niches to explicitly exclude:
   These are niches that share audience overlap with the target but are NOT what the reference accounts cover.
   Annotate your "derivedNiche" output with these exclusions.
   Reference examples (use your own judgment, these are illustrations only):
   - Reference = entrepreneurship/startup tips → EXCLUDE: trading, investing, crypto, personal finance, podcast-only accounts
   - Reference = fitness/gym content → EXCLUDE: nutrition coaching, wellness/mindfulness, yoga, sports supplements
   - Reference = beauty/makeup tutorials → EXCLUDE: fashion/OOTD, general lifestyle, skincare brand accounts
   - Reference = travel vlogging → EXCLUDE: adventure sports, food-tourism-only, general lifestyle
   A candidate whose bio leads with excluded-niche signals (e.g. "📈 trading tips", "forex", "crypto alpha", "stock picks") is in the EXCLUDED adjacent niche — reject them even if they occasionally post adjacent content.

Populate "derivedNiche" as: "<sub-niche> | EXCLUDE: <adjacent1>, <adjacent2>"\n`
    : ''

  return `You are an Instagram competitive intelligence analyst for a social media agency.

REFERENCE ACCOUNTS (the client's handles or known competitors in their niche):
${inputSummary}
${clarificationSection}${nicheContextSection}${nicheSignalsSection}${nicheDeriveBlock}
YOUR TASK:
Analyze the candidate accounts below and select ${countInstruction}:
- 5 "${topCategory.label}" competitors: ${topCategory.taxonomy}
- 5 "${trendingCategory.label}" competitors: ${trendingCategory.taxonomy}

CANDIDATE ACCOUNTS:
${candidateSummary}

SELECTION CRITERIA:
- FIRST: Check niche relevance. If EXPLICIT NICHE CONTEXT is provided above, treat it as the definitive niche boundary. When the niche is a PROFESSION (e.g. "marketing education", "productivity coaching", "content strategy"), accounts whose PRIMARY focus is a TOOL CATEGORY adjacent to that profession (e.g. "AI tools reviews", "tech news", "coding tutorials") are NOT niche-relevant — even if that tool is used by the profession. Include an account only if its primary content IS the profession itself, not just the tools. If only NICHE SIGNALS are provided, apply the same distinction. Borderline accounts whose content is clearly about the profession topic (even if they sometimes cover tools) should be included.
- ADJACENT NICHE GUARD: Different sub-niches within the same broad umbrella are still different niches. "Entrepreneurship tips" and "trading/investing" are both "business" broadly — but they are NOT the same niche and serve different audiences. Apply the STEP 2 exclusion list from NICHE DERIVATION above: reject any candidate whose PRIMARY content or bio belongs to an adjacent-but-excluded sub-niche, even if they occasionally post on-niche content. Bio signals are decisive: a bio leading with trading emojis (📈), "forex", "crypto", "stock picks", or similar adjacent-niche language indicates an excluded account.
- SOURCE PRIORITY: Each candidate is labeled [CONTENT-NICHE] or [AUDIENCE-ADJACENT]. [CONTENT-NICHE] candidates were discovered by scraping posts that used the reference accounts' own hashtags — they are the highest-confidence niche matches. [AUDIENCE-ADJACENT] candidates came from Instagram's relatedProfiles graph (audience overlap) — they may or may not share the niche. When assigning candidates to Top 5 or Trending 5, prefer [CONTENT-NICHE] accounts over [AUDIENCE-ADJACENT] accounts at the same follower tier and ER band. Do NOT override the Top/Trending tier logic: a [CONTENT-NICHE] account with 50K followers still belongs in Trending, not Top. Only include an [AUDIENCE-ADJACENT] candidate if (a) there are not enough [CONTENT-NICHE] accounts to fill the category, AND (b) their bio clearly confirms niche alignment with the reference accounts.
- GOAL: Fill both categories as completely as possible. Aim for 5 in each. Only reduce the count if there are genuinely not enough niche-relevant candidates — do not leave slots empty out of excessive strictness.
- For Top 5: prioritize follower count, brand authority, posting consistency, and verified status. Accounts with the [ESTABLISHED: 500K+ followers] label MUST be assigned to Top, not Trending.
- For Trending 5: prioritize engagement rate (ER %) relative to follower tier — accounts in their growth phase where ER significantly exceeds peers at the same follower count.
- When a candidate could qualify for either category (mid-tier account with decent followers AND high ER), prefer Trending if the account has under 500K followers.
- If a candidate fits both Top and Trending criteria, assign it to whichever category has fewer entries.

OUTPUT FORMAT (respond with valid JSON only, no markdown):
{
  "derivedNiche": "<specific sub-niche derived from the reference accounts, e.g. 'entrepreneurship & startup content' — NOT the raw keyword>",
  "niche": "<2–4 word description of the niche, e.g. 'personal productivity creators' or 'marketing education'>",
  "summary": "<2 sentences. Lead with the most important competitive insight (who dominates, what the ER range looks like, whether the space is consolidated or fragmented). Second sentence: what this means for brand partnerships in this niche.>",
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
      return `@${p.username} | type: ${accountType} | followers: ${p.followersCount.toLocaleString()} | ER: ${er}% | posts: ${p.postsCount} | verified: ${p.verified} | bio: "${p.biography.replace(/[\n\r]/g, ' ').replace(/"/g, '\\"').slice(0, 150)}"${establishedLabel}`
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
- MINIMUM RESULT COUNT: Return up to 10 results. If fewer than 10 candidate profiles appear in this list, return all of them. Do not fabricate or guess handles not in the list above.

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

// ----- Clarification prompt -----

/**
 * Build the niche clarification prompt.
 * Gemini looks at the first 20 candidates and generates one targeted question
 * with 3–4 options that capture the real sub-niche splits it observes.
 *
 * The result is shown to the user before ranking runs — their answer is injected
 * into buildCompetitorPrompt as a USER REFINEMENT block (clarificationAnswer param).
 */
export function buildClarificationPrompt(
  referenceProfile: NormalizedProfile,
  candidates: NormalizedProfile[],
  nicheContext: string,
): string {
  const top20 = candidates.slice(0, 20)
  const candidateList = top20
    .map((p) => `@${p.username}: "${p.biography.replace(/[\n\r]/g, ' ').replace(/"/g, '\\"').slice(0, 80)}" (${p.followersCount.toLocaleString()} followers)`)
    .join('\n')

  const nicheContextLine = nicheContext.trim()
    ? `\nStated niche: "${nicheContext.trim()}"`
    : ''

  return `You are analyzing Instagram account candidates to help a content strategist narrow their competitor research.

Reference account: @${referenceProfile.username} (${referenceProfile.followersCount.toLocaleString()} followers)
Bio: "${referenceProfile.biography.replace(/[\n\r]/g, ' ').replace(/"/g, '\\"').slice(0, 120)}"${nicheContextLine}

I found ${candidates.length} candidate accounts. Here are the first 20:
${candidateList}

Look at these accounts and identify the main sub-niche directions they fall into.
Generate ONE targeted question and 3–4 options that capture the real splits you see.

Rules:
- Question must be specific to what you actually found — not generic
- Options must be concrete and distinct (not "other" or "all of the above")
- If all accounts clearly fit one niche, generate 2 options showing the focused spectrum
- Options should be 5–10 words each

Return JSON: { "question": "...", "options": ["...", "...", "..."] }`
}

// ──────────────────────────────────────────────────────────
// Conversational intent parsing
// ──────────────────────────────────────────────────────────

/**
 * Build the intent-parsing prompt for the conversational agent.
 *
 * Gemini parses the user's natural-language request and extracts:
 *   - niche: what kind of accounts they want to find (required)
 *   - location: optional city for location-scoped discovery
 *   - knownHandles: any @handles the user mentioned (seeds for analysis)
 *   - depth: 'standard' or 'deep' (inferred from "thorough"/"deep"/"quick" keywords)
 *   - clientName: client name mentioned for export labelling
 *
 * Returns needsClarification=true if the message is ambiguous or off-topic.
 * Max ONE clarification turn per conversation.
 *
 * Output: strict JSON with no markdown.
 */
export function buildIntentPrompt(userMessage: string): string {
  const safeMessage = userMessage.replace(/[\n\r]/g, ' ').trim().slice(0, 500)
  return `You are an intent parser for a social media competitor analysis tool.

The user types a natural-language request. Extract the intent as JSON.

USER MESSAGE: "${safeMessage.replace(/"/g, '\\"')}"

EXTRACT:
- niche (required): what type of accounts they want to find, in 2-5 words (e.g. "food creators", "fitness influencers", "travel bloggers", "marketing educators")
- location (optional): city or region they mentioned (e.g. "Mumbai", "New York", "India")
- knownHandles (optional): any @handles or handle-like strings they mentioned (max 5, strip @ prefix)
- depth: "deep" if they say "thorough", "complete", "deep scan", "detailed"; otherwise "standard"
- clientName (optional): client or brand name they mentioned for the report (e.g. "for Acme Corp")
- needsClarification: true ONLY if the message is completely ambiguous, off-topic, or you cannot determine a niche at all

RULES:
- If you can extract a niche with reasonable confidence, set needsClarification=false
- Only set needsClarification=true as a last resort — prefer a best-guess niche
- If needsClarification=true, provide a short clarifying question in the "question" field
- niche should describe WHO to find, not WHAT TO DO (not "analyze competitors", not "find accounts")
- Strip @ from any handles mentioned

PIPELINE ROUTING:
Determine pipelineType based on what the user is asking for:
- "discovery": user wants creators geographically located in a specific city/region
  Examples: "find food bloggers in Mumbai", "who's posting about yoga in Delhi",
  "creators based in Singapore", "local influencers in Lagos"
- "competitor": user wants to find who's succeeding in a niche, regardless of location
  Examples: "find competitors to @handle", "who's winning in fitness",
  "top travel influencers", "similar accounts to X"
- Default to "competitor" when unclear or when no location is mentioned.
- When a location IS mentioned but phrasing is competitive ("top X in Y", "best X in Y"),
  use "competitor" — location becomes a context filter, not a discovery dimension.
- Only use "discovery" when the user's goal is explicitly geographic.
- routingConfidence: "high" if the pipelineType is unambiguous from the message;
  "medium" if you had to make a judgment call or the message could fit either pipeline.

HANDLE EXTRACTION EXAMPLES:
- "like @foodie.creator and @chefmike" → knownHandles: ["foodie.creator", "chefmike"]
- "similar to thesortedgirl, pritika.loonia" → knownHandles: ["thesortedgirl", "pritika.loonia"]
- "reference accounts: damini.creator" → knownHandles: ["damini.creator"]
- words after "like", "similar to", "reference", "such as", "including" are likely handles — extract them even without @

OUTPUT FORMAT (valid JSON only, no markdown):
{
  "needsClarification": false,
  "niche": "food creators",
  "location": "Mumbai",
  "knownHandles": ["foodie.creator", "chefmike"],
  "depth": "standard",
  "clientName": null,
  "pipelineType": "competitor",
  "routingConfidence": "high"
}

OR if clarification needed:
{
  "needsClarification": true,
  "question": "What type of accounts are you looking for? (e.g. food bloggers, fitness coaches, travel photographers)"
}`
}

// ── Follow-up prompts ────────────────────────────────────────────────────────

/**
 * Build the system context injected into a follow-up refinement call.
 *
 * Follow-up messages bypass parseIntent() entirely and go straight to a prose
 * Gemini call (callGeminiFollowUp). This context tells Gemini what the
 * pipeline already produced so it can give an informed refinement response
 * rather than treating the follow-up as a brand-new query.
 *
 * @param summary          A short human-readable description of what the pipeline
 *                         found, e.g. "Found 8 fitness creators in Mumbai" or
 *                         "Competitor analysis complete — 12 accounts in the
 *                         Indian food blogging space".
 * @param accountSummaries Optional list of accounts found by the pipeline.
 *                         When provided, Gemini can reference specific accounts
 *                         when answering refinement questions.
 */
export function buildFollowUpContext(
  summary: string,
  accountSummaries?: Array<{ username: string; followers: number; er: number }>,
): string {
  // Sanitize usernames before embedding in the prompt — Apify data is external and could
  // contain prompt-injection text. Instagram usernames are [a-zA-Z0-9._] only.
  const accountsSection = accountSummaries && accountSummaries.length > 0
    ? `\nACCOUNTS FOUND:\n${accountSummaries
        .map((a) => {
          const safeUsername = a.username.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30)
          return `@${safeUsername} — ${a.followers.toLocaleString()} followers, ${a.er.toFixed(1)}% ER`
        })
        .join('\n')}\n`
    : ''

  return `You are a helpful assistant for a social media creator research tool.

The analysis pipeline just completed with the following result:
${summary}
${accountsSection}
The user is now sending a follow-up message to refine or filter these results.
Respond conversationally in 1-3 sentences. Focus on:
- Acknowledging what they want to refine or filter
- Confirming whether their refinement can be applied to the existing results
- Suggesting a concrete next action if useful (e.g. "Start a new search for micro-influencers only")

Do not re-run any analysis. Do not describe capabilities you don't have.
Keep your response short, friendly, and actionable.`
}

/**
 * Build the prompt used to map a free-text confirming-state reply to one of the
 * available pipeline option strings.
 *
 * The return schema is { "selectedOption": "<one of availableOptions>" }.
 * Callers MUST validate that the returned value is actually in availableOptions
 * and fall back to availableOptions[0] if not.
 *
 * @param userText         The raw user message (should already be sanitised — max 500 chars, newlines stripped).
 * @param availableOptions The exact option strings Gemini must choose between.
 */
export function buildConfirmReplyPrompt(userText: string, availableOptions: string[]): string {
  // JSON.stringify produces a fully-escaped string (handles backslashes, control chars,
  // Unicode, quotes). Slice off the surrounding " chars since we embed inline.
  const safeText = JSON.stringify(userText.slice(0, 500).replace(/[\n\r]/g, ' ')).slice(1, -1)
  const optionList = availableOptions.map((o, i) => `${i + 1}. "${o}"`).join('\n')

  return `You are mapping a user's free-text reply to one of the available options for a social media analysis pipeline.

USER REPLY: "${safeText}"

AVAILABLE OPTIONS:
${optionList}

Pick the option the user most likely means. If they say "yes", "go", "ok", "start", "sure", or similar, choose option 1 (the default proceed option).

Return JSON only: { "selectedOption": "<exact option string from the list above>" }`
}
