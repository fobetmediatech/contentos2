/**
 * Hashtag generator for location-based creator discovery.
 *
 * Primary path: single Gemini micro-call → 6-8 relevant hashtags.
 * Fallback path: template-based rule generator (fires when Gemini is unavailable).
 *
 * The generated hashtags are passed to the Apify Hashtag Scraper to pull
 * recent posts, from which creator handles are extracted.
 *
 * Input sanitization is applied before Gemini injection to prevent prompt injection:
 *   - Strip newlines, trim whitespace
 *   - Clamp: city ≤ 50 chars, niche ≤ 100 chars
 *   - Allow only word chars, spaces, commas, hyphens
 */

import { geminiHeaders } from '../ai/gemini'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-2.5-flash'

// Number of hashtags to request per depth level
const HASHTAG_COUNT: Record<'standard' | 'deep', number> = {
  standard: 5,
  deep: 8,
}

// ----- Input sanitization -----

const SAFE_PATTERN = /[^\w\s,-]/g  // allow word chars, spaces, commas, hyphens

export function sanitize(input: string, maxLen: number): string {
  return input
    .replace(/[\n\r]/g, ' ')    // strip newlines
    .replace(SAFE_PATTERN, '')  // remove disallowed chars
    .trim()
    .slice(0, maxLen)
}

// ----- Rule-based fallback -----

/**
 * Generate hashtags from a simple template when Gemini is unavailable.
 * Works for any city + niche combination without an API call.
 */
export function ruleFallback(city: string, niche: string, count: number): string[] {
  const c = city.replace(/\s+/g, '')   // "New Delhi" → "NewDelhi"
  const n = niche.replace(/\s+/g, '')  // "street food" → "streetfood"
  const cityLower = city.toLowerCase().replace(/\s+/g, '')
  const nicheLower = niche.toLowerCase().replace(/\s+/g, '')

  // Mix two tag types for best creator coverage:
  //   1. Content tags (what creators post under): IndoreFood, IndoreFoodie, IndoreEats
  //   2. Creator self-ID tags (what creators use to label themselves): IndoreFoodVlogger, IndoreFoodBlogger
  // Self-ID tags surface creator handles directly — vloggers tag every post with them,
  // so scraping them yields creator ownerUsername values, not business accounts.
  const candidates = [
    `${c}${n}`,                   // IndoreFood
    `${c}${n}Vlogger`,            // IndoreFoodVlogger (creator self-ID)
    `${c}${n}Blogger`,            // IndoreFoodBlogger (creator self-ID)
    `${cityLower}${nicheLower}`,  // indorefood
    `${c}Foodie`,                 // IndoreFoodie
    `${c}StreetFood`,             // IndoreStreetFood
    `${c}Eats`,                   // IndoreEats
    `${nicheLower}${cityLower}`,  // foodindore
    `${c}FoodLovers`,             // IndoreFoodLovers
    `${c}Diaries`,                // IndoreDiaries
    `${c}Bites`,                  // IndoreBites
  ]

  // Deduplicate case-insensitively, take first `count`
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of candidates) {
    const key = tag.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(tag)
    }
    if (result.length >= count) break
  }
  return result
}

// ----- Gemini micro-call -----

async function callGeminiForHashtags(
  geminiKey: string,
  city: string,
  niche: string,
  count: number,
  signal?: AbortSignal,
  excludeHashtags?: string[],
): Promise<string[]> {
  const citySlug = city.replace(/\s+/g, '')

  // Sanitize exclusion list before prompt injection — strip non-word chars, cap length
  const exclusionClause = excludeHashtags && excludeHashtags.length > 0
    ? `\nDo NOT repeat any of these hashtags (already tried): ${
        excludeHashtags
          .map(h => h.replace(/[^\w]/g, '').slice(0, 30))
          .filter(Boolean)
          .join(', ')
      }. Generate ${count} DIFFERENT hashtags targeting a different angle (e.g. nearby area, alternate spelling, related sub-niche).\n`
    : ''

  const prompt = `Generate ${count} Instagram hashtags for finding ${niche} content creators based in ${city}. Mix two types:

1. CONTENT hashtags — tags creators add to their own posts: ${citySlug}Food, ${citySlug}Foodie, ${citySlug}Eats, ${citySlug}StreetFood
2. CREATOR SELF-ID hashtags — tags creators use to label themselves as a vlogger/blogger in this city: ${citySlug}FoodVlogger, ${citySlug}FoodBlogger, ${citySlug}Foodie

Include at least 2 creator self-ID hashtags — these directly surface creator account handles because vloggers and bloggers tag every post with them to build their audience.

DO NOT generate collab-seeking hashtags used by businesses (e.g. "FoodVloggerWanted", "InfluencerNeeded", "PRCollab") — those are posted by brands, not creators.
${exclusionClause}
Good examples for food in Indore: "IndoreFood", "IndoreFoodVlogger", "IndoreFoodBlogger", "IndoreFoodie", "IndoreEats", "IndoreStreetFood"
Good examples for fitness in Mumbai: "MumbaiFitness", "MumbaiFitnessVlogger", "MumbaiFitnessBlogger", "MumbaiGym", "FitMumbai"

Return ONLY a JSON array of strings. No # prefix. No explanation. No markdown.`

  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: geminiHeaders(geminiKey),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`Gemini hashtag call failed: ${res.status}`)
  }

  const json = await res.json()
  const candidate = json.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? '')
    .join('')

  if (!text) throw new Error('Gemini returned empty response for hashtags')

  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(cleaned)

  if (!Array.isArray(parsed)) throw new Error('Gemini hashtag response is not an array')

  // Sanitize: remove # prefix, strip non-alphanumeric/underscore chars (Instagram rules),
  // truncate to 30 chars (Instagram hashtag limit), filter empties, dedup
  const tags = [...new Set(
    parsed
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.replace(/^#/, '').replace(/[^\w]/g, '').slice(0, 30).trim())
      .filter(Boolean)
  )]

  if (tags.length === 0) throw new Error('Gemini returned empty hashtag array')
  return tags.slice(0, count)
}

// ----- Public API -----

export interface HashtagResult {
  hashtags: string[]
  /** true = Gemini call succeeded; false = rule-based fallback was used */
  fromAI: boolean
}

/**
 * Generate location-aware Instagram hashtags for a city + niche.
 *
 * Tries Gemini first; falls back to template rules on any error.
 *
 * @param geminiKey       Gemini API key (may be empty — triggers fallback immediately)
 * @param city            City name (e.g. "Mumbai"). Sanitized before injection.
 * @param niche           Content niche (e.g. "food"). Sanitized before injection.
 * @param depth           'standard' = 5 hashtags, 'deep' = 8 hashtags
 * @param signal          AbortController signal
 * @param excludeHashtags Hashtags already tried — Gemini is instructed to avoid them.
 *                        Sanitized inside this function before prompt injection.
 */
export async function generateHashtags(
  geminiKey: string,
  city: string,
  niche: string,
  depth: 'standard' | 'deep' = 'standard',
  signal?: AbortSignal,
  excludeHashtags?: string[],
): Promise<HashtagResult> {
  // Sanitize inputs before any external call
  const safeCity = sanitize(city, 50)
  const safeNiche = sanitize(niche, 100)
  const count = HASHTAG_COUNT[depth]

  if (!safeCity || !safeNiche) {
    return { hashtags: ruleFallback(city.trim(), niche.trim(), count), fromAI: false }
  }

  // Try Gemini — fall back to rules on any error
  if (geminiKey?.trim()) {
    try {
      const hashtags = await callGeminiForHashtags(geminiKey, safeCity, safeNiche, count, signal, excludeHashtags)
      console.log(`[hashtagGenerator] Gemini returned ${hashtags.length} hashtags:`, hashtags)
      return { hashtags, fromAI: true }
    } catch (err) {
      console.warn('[hashtagGenerator] Gemini call failed, using rule fallback:', err)
    }
  }

  const hashtags = ruleFallback(safeCity, safeNiche, count)
  console.log(`[hashtagGenerator] Rule fallback returned ${hashtags.length} hashtags:`, hashtags)
  return { hashtags, fromAI: false }
}
