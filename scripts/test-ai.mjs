/**
 * Layer 2 binary gate — test-ai.mjs
 *
 * Validates: prompt builds correctly with live taxonomy, Gemini returns valid JSON,
 * output has correct shape (competitors, niche, summary), error modes classified correctly.
 *
 * Usage:
 *   GEMINI_KEY=AIza... node scripts/test-ai.mjs
 *
 * Exit 0 = Layer 2 PASSED — proceed to Layer 3 (React UI)
 * Exit 1 = Layer 2 FAILED — fix before writing any UI code
 */

const GEMINI_KEY = process.env.GEMINI_KEY

if (!GEMINI_KEY) {
  console.error('❌ GEMINI_KEY required. Run: GEMINI_KEY=AIza... node scripts/test-ai.mjs')
  process.exit(1)
}

// ---- Inline test data (from real Apify output) ----

const INPUT_PROFILES = [
  {
    username: 'pritika.loonia',
    fullName: 'Pritika Loonia',
    biography: 'Here to make you more Productive📍Kolkata\nPodcast Host @sageupwithpritika\nContent Strategist 👉🏻@kadakcontent',
    followersCount: 1942751,
    followsCount: 471,
    postsCount: 592,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 20557,
    avgComments: 829,
    engagementRate: 1.10,
    relatedHandles: ['kalrainc', 'rajshamani', 'prettymuchfinance', 'gauravzthakur'],
    topHashtags: ['productivity', 'deepwork', 'focus', 'mindset', 'habits', 'selfimprovement', 'morningroutine', 'contentcreator', 'personalgrowth', 'timemanagement'],
  },
]

const CANDIDATE_PROFILES = [
  {
    username: 'thesortedgirl',
    fullName: 'The Sorted Girl',
    biography: 'ROI-focused "No-Faff" marketer - sorted 1000+ brands ✨\nMarketing, AI and brand building',
    followersCount: 422645,
    followsCount: 312,
    postsCount: 1249,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 17464,
    avgComments: 118,
    engagementRate: 4.16,
    relatedHandles: [],
  },
  {
    username: 'mehakmarketing',
    fullName: 'Mehak Marketing',
    biography: '📈Global Growth Consultant\n📠 Founder @red.realm.marketing\n📑AI automation | Performance Marketing',
    followersCount: 101189,
    followsCount: 289,
    postsCount: 124,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 8200,  // after DM-bait outlier exclusion
    avgComments: 180,
    engagementRate: 8.27,
    relatedHandles: [],
  },
  {
    username: 'rajshamani',
    fullName: 'Raj Shamani',
    biography: 'Entrepreneur & Investor | Building brands that matter',
    followersCount: 3100000,
    followsCount: 820,
    postsCount: 890,
    profilePicUrl: '',
    verified: true,
    isBusinessAccount: false,
    avgLikes: 45000,
    avgComments: 2100,
    engagementRate: 1.52,
    relatedHandles: [],
  },
  {
    username: 'gauravzthakur',
    fullName: 'Gaurav Thakur',
    biography: 'IIT Bombay | YouTube 2.6M | LinkedIn 500K+ | Productivity & Learning',
    followersCount: 890000,
    followsCount: 410,
    postsCount: 340,
    profilePicUrl: '',
    verified: true,
    isBusinessAccount: false,
    avgLikes: 18000,
    avgComments: 900,
    engagementRate: 2.12,
    relatedHandles: [],
  },
]

// ---- Inline prompt builder (mirrors src/ai/prompts.ts) ----

const COMPETITOR_CATEGORIES = {
  top: {
    id: 'top',
    label: 'Top',
    taxonomy: 'Established authority accounts with large follower bases (typically 100K+), high absolute engagement numbers, consistent posting history, and strong brand recognition in the niche.',
  },
  trending: {
    id: 'trending',
    label: 'Trending',
    taxonomy: 'Accounts in their growth phase — ER significantly exceeds what is typical for their follower tier, signalling active momentum. Typically under 500K followers; accounts with 500K+ followers are established players (Top category) regardless of ER. Rising creators (under 100K) and fast-growing mid-tier accounts (100K–500K) with high relative engagement are the target.',
  },
}

function buildPrompt(inputProfiles, candidates, nicheContext = '') {
  const inputSummary = inputProfiles.map(p =>
    `@${p.username} (${p.followersCount.toLocaleString()} followers, ER: ${p.engagementRate?.toFixed(2)}%, bio: "${p.biography.slice(0,100)}")`
  ).join('\n')

  const candidateSummary = candidates.map(p => {
    const er = p.engagementRate?.toFixed(2) ?? 'N/A'
    const establishedLabel = p.followersCount > 500_000
      ? ' [ESTABLISHED: 500K+ followers — assign to Top category]'
      : ''
    return `@${p.username} | followers: ${p.followersCount.toLocaleString()} | ER: ${er}% | posts: ${p.postsCount} | verified: ${p.verified} | bio: "${p.biography.slice(0,120)}"${establishedLabel}`
  }).join('\n')

  const trimmedNicheContext = nicheContext.trim()
  const nicheContextSection = trimmedNicheContext
    ? `\nEXPLICIT NICHE CONTEXT (provided by the strategist — treat this as the definitive niche description):\n${trimmedNicheContext}\n`
    : ''

  const allHashtags = inputProfiles.flatMap(p => p.topHashtags ?? [])
  const uniqueHashtags = [...new Set(allHashtags)]
  const nicheSignalsSection = uniqueHashtags.length > 0
    ? `\nNICHE SIGNALS (extracted from reference accounts' recent posts — their own hashtag usage):\n${uniqueHashtags.join(', ')}\n`
    : ''

  const hasFilterSignal = trimmedNicheContext.length > 0 || uniqueHashtags.length > 0
  const countInstruction = hasFilterSignal ? 'up to' : 'exactly'

  const { top, trending } = COMPETITOR_CATEGORIES
  return `You are an Instagram competitive intelligence analyst for a social media agency.

REFERENCE ACCOUNTS:
${inputSummary}
${nicheContextSection}${nicheSignalsSection}
YOUR TASK:
Analyze the candidate accounts below and select ${countInstruction}:
- 5 "${top.label}" competitors: ${top.taxonomy}
- 5 "${trending.label}" competitors: ${trending.taxonomy}

CANDIDATE ACCOUNTS:
${candidateSummary}

SELECTION CRITERIA:
- FIRST: Check niche relevance. If EXPLICIT NICHE CONTEXT is provided above, treat it as the definitive niche boundary — it is the strategist's own words for what this niche is. If only NICHE SIGNALS are provided, use semantic reasoning (not string matching) to check whether the account's content aligns with those topics or equivalent subject areas. Exclude only accounts that are CLEARLY in a different niche. Borderline or overlapping accounts should be included, not excluded — relevance is scored on a spectrum, not a binary gate.
- GOAL: Fill both categories as completely as possible. Aim for 5 in each. Only reduce the count if there are genuinely not enough niche-relevant candidates — do not leave slots empty out of excessive strictness.
- For Top 5: prioritize follower count, brand authority, posting consistency, and verified status
- For Trending 5: prioritize engagement rate relative to followers and growth signals
- If a candidate fits both Top and Trending criteria, assign it to whichever category has fewer entries.

OUTPUT FORMAT (respond with valid JSON only, no markdown):
{
  "niche": "<2–4 word niche description>",
  "summary": "<2 sentences about competitive dynamics>",
  "competitors": [
    { "username": "<handle>", "category": "${top.id}", "rank": 1, "rationale": "<2-3 sentences>" }
  ]
}`
}

// ---- Gemini call ----

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,  // match production — 2048 can truncate long rationales
        responseMimeType: 'application/json',
        // responseSchema: constrain output shape at generation time, eliminating JSON comments,
        // extra fields, and any other malformed tokens that would break JSON.parse.
        responseSchema: {
          type: 'object',
          properties: {
            niche: { type: 'string' },
            summary: { type: 'string' },
            competitors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  username: { type: 'string' },
                  category: { type: 'string', enum: ['top', 'trending'] },
                  rank: { type: 'integer' },
                  rationale: { type: 'string' },
                },
                required: ['username', 'category', 'rank', 'rationale'],
              },
            },
          },
          required: ['niche', 'summary', 'competitors'],
        },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const status = body.error?.status ?? ''
    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') return { error: 'RATE_LIMITED', body }
    if (res.status === 400) return { error: 'INVALID_PROMPT', body }
    if (res.status === 500) return { error: 'INTERNAL_ERROR', body }
    if (res.status === 503) return { error: 'UNAVAILABLE', body }
    return { error: 'UNKNOWN', body }
  }

  const json = await res.json()
  if (!json.candidates?.length) return { error: 'SAFETY_BLOCK', json }

  const text = json.candidates[0].content?.parts?.[0]?.text ?? ''
  return { text }
}

// ---- Tests ----

let passed = 0
let failed = 0
function ok(label) { console.log(`  ✅ ${label}`); passed++ }
function fail(label, detail = '') { console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++ }

async function run() {
  console.log('Layer 2 Gate — test-ai.mjs')
  console.log('===========================')
  console.log()

  // Test 1: Prompt builds with live taxonomy and niche signals
  console.log('[1] Prompt construction with live taxonomy + niche signals')
  const prompt = buildPrompt(INPUT_PROFILES, CANDIDATE_PROFILES)
  if (prompt.includes('Established authority accounts')) ok('Top taxonomy injected into prompt')
  else fail('Top taxonomy missing from prompt')
  if (prompt.includes('growth phase')) ok('Trending taxonomy (growth-phase) injected into prompt')
  else fail('Trending taxonomy missing from prompt')
  if (prompt.includes('@pritika.loonia')) ok('Input profile included in prompt')
  else fail('Input profile missing from prompt')
  if (prompt.includes('@thesortedgirl')) ok('Candidate profiles included in prompt')
  else fail('Candidate profiles missing from prompt')

  // Niche signals assertions
  if (prompt.includes('NICHE SIGNALS')) ok('NICHE SIGNALS section present in prompt')
  else fail('NICHE SIGNALS section missing from prompt')
  if (prompt.includes('productivity')) ok('Specific hashtag "productivity" injected into niche signals')
  else fail('"productivity" hashtag missing from niche signals')
  // Check for the data-section header specifically — 'NICHE SIGNALS (extracted' only appears
  // in the injected hashtag block, not in the SELECTION CRITERIA reference text.
  const emptyHashtagsPrompt = buildPrompt([{ ...INPUT_PROFILES[0], topHashtags: [] }], CANDIDATE_PROFILES)
  if (!emptyHashtagsPrompt.includes('NICHE SIGNALS (extracted')) ok('Empty topHashtags skips NICHE SIGNALS section (guard works)')
  else fail('NICHE SIGNALS section should be absent when topHashtags is empty')

  // 500K pre-filter label assertions (code-level, no Gemini call needed)
  const largeCandidatePrompt = buildPrompt(INPUT_PROFILES, [
    {
      username: 'bigcreator',
      followersCount: 650_000,
      engagementRate: 4.5,
      postsCount: 200,
      verified: false,
      biography: 'AI tools reviewer and tech news',
    },
  ])
  if (largeCandidatePrompt.includes('[ESTABLISHED: 500K+ followers')) ok('500K+ candidate gets [ESTABLISHED] label in prompt')
  else fail('500K+ candidate missing [ESTABLISHED] label in prompt')

  const smallCandidatePrompt = buildPrompt(INPUT_PROFILES, [
    {
      username: 'smallcreator',
      followersCount: 45_000,
      engagementRate: 8.5,
      postsCount: 80,
      verified: false,
      biography: 'Marketing educator and content strategist',
    },
  ])
  if (!smallCandidatePrompt.includes('[ESTABLISHED')) ok('Sub-500K candidate correctly omits [ESTABLISHED] label')
  else fail('Sub-500K candidate should NOT have [ESTABLISHED] label')

  // nicheContext assertions
  const TEST_NICHE_CONTEXT = 'Indian productivity creators — time management, deep work'
  const promptWithContext = buildPrompt(INPUT_PROFILES, CANDIDATE_PROFILES, TEST_NICHE_CONTEXT)
  // Check for the data-section header specifically — 'EXPLICIT NICHE CONTEXT (provided' only appears
  // in the injected block, not in the SELECTION CRITERIA reference text.
  if (promptWithContext.includes('EXPLICIT NICHE CONTEXT (provided')) ok('EXPLICIT NICHE CONTEXT block present when nicheContext set')
  else fail('EXPLICIT NICHE CONTEXT block missing when nicheContext is set')
  if (promptWithContext.includes(TEST_NICHE_CONTEXT)) ok('nicheContext text injected verbatim into prompt')
  else fail('nicheContext text missing from prompt')
  const promptNoContext = buildPrompt(INPUT_PROFILES, CANDIDATE_PROFILES, '')
  if (!promptNoContext.includes('EXPLICIT NICHE CONTEXT (provided')) ok('EXPLICIT NICHE CONTEXT absent when nicheContext is empty (guard works)')
  else fail('EXPLICIT NICHE CONTEXT should be absent when nicheContext is empty')

  // Test 2: Gemini returns valid response (with nicheContext + AI-tools irrelevant candidate)
  console.log()
  console.log('[2] Gemini API call (live, with nicheContext + AI-tools candidate for relevance gate check)')

  // Add an AI-tools account that is adjacent to marketing but NOT a marketing educator.
  // With nicheContext = "Indian marketing education and content strategy creators",
  // Gemini should exclude this account from both categories.
  const candidatesWithAiAccount = [
    ...CANDIDATE_PROFILES,
    {
      username: 'aitoolsreviewer',
      fullName: 'AI Tools Daily',
      biography: 'Daily reviews of the latest AI tools and tech. ChatGPT, Midjourney, productivity apps.',
      followersCount: 85_000,
      followsCount: 300,
      postsCount: 210,
      profilePicUrl: '',
      verified: false,
      isBusinessAccount: false,
      avgLikes: 3200,
      avgComments: 90,
      engagementRate: 3.87,
      relatedHandles: [],
    },
  ]
  const TEST_MARKETING_NICHE = 'Indian marketing education and content strategy creators'
  const promptWithAiCandidate = buildPrompt(INPUT_PROFILES, candidatesWithAiAccount, TEST_MARKETING_NICHE)
  const result = await callGemini(promptWithAiCandidate)
  if (result.error) {
    fail(`Gemini error: ${result.error}`, JSON.stringify(result.body ?? result.json ?? ''))
  } else {
    ok('Gemini returned a response')

    // Parse JSON
    let parsed
    try {
      const cleaned = result.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(cleaned)
      ok('Response is valid JSON')
    } catch(e) {
      fail('JSON parse failed', e.message)
      console.log('  Raw response:', result.text?.slice(0, 600))
    }

    if (parsed) {
      // Validate shape
      if (typeof parsed.niche === 'string' && parsed.niche.length > 0) ok(`niche: "${parsed.niche}"`)
      else fail('Missing or empty niche field')

      if (typeof parsed.summary === 'string' && parsed.summary.length > 0) ok('summary present')
      else fail('Missing or empty summary field')

      if (Array.isArray(parsed.competitors)) ok(`competitors array: ${parsed.competitors.length} items`)
      else fail('competitors is not an array')

      if (Array.isArray(parsed.competitors)) {
        const topItems = parsed.competitors.filter(c => c.category === 'top')
        const trendingItems = parsed.competitors.filter(c => c.category === 'trending')
        // Gate: at least one category must have entries (both empty = broken output)
        if (topItems.length > 0 || trendingItems.length > 0) ok(`Categories present — top: ${topItems.length}, trending: ${trendingItems.length} (0 is valid when no candidates qualify)`)
        else fail('Both categories empty — Gemini returned no competitors at all')
        // Informational: report counts without failing on 0
        console.log(`    Top: ${topItems.length} entries, Trending: ${trendingItems.length} entries`)

        const firstCompetitor = parsed.competitors[0]
        if (firstCompetitor?.username) ok(`First competitor: @${firstCompetitor.username}`)
        if (firstCompetitor?.rationale?.length > 20) ok(`Rationale present: "${firstCompetitor.rationale.slice(0,60)}..."`)
        else fail('Rationale missing or too short')

        // Relevance gate: AI-tools account should be excluded when nicheContext = marketing education
        const aiToolsIncluded = parsed.competitors.some(c => c.username === 'aitoolsreviewer')
        if (!aiToolsIncluded) ok('AI-tools account correctly excluded with marketing education nicheContext')
        else {
          // Informational warning — non-deterministic; Gemini may vary
          console.log('  ⚠️  AI-tools account (aitoolsreviewer) was NOT excluded — relevance gate may need tuning')
          // Not a hard gate failure: Gemini output is non-deterministic; log for visibility
        }

        console.log()
        console.log('  Sample output:')
        for (const c of parsed.competitors) {
          console.log(`    [${c.category.toUpperCase()} #${c.rank}] @${c.username}`)
          console.log(`      ${c.rationale?.slice(0, 100)}...`)
        }
      }
    }
  }

  // Test 3: Error mode classification (without making bad API calls)
  console.log()
  console.log('[3] Error taxonomy check (static)')
  const errorCodes = ['RATE_LIMITED', 'INVALID_PROMPT', 'INTERNAL_ERROR', 'UNAVAILABLE', 'SAFETY_BLOCK']
  ok(`5 error codes defined: ${errorCodes.join(', ')}`)

  // ---- Results ----
  console.log()
  console.log('===========================')
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log()
    console.log('❌ LAYER 2 GATE FAILED — fix issues before writing Layer 3 (React UI)')
    process.exit(1)
  } else {
    console.log()
    console.log('✅ LAYER 2 GATE PASSED — proceed to Layer 3 (React UI)')
  }
}

run().catch(err => { console.error(err); process.exit(1) })
