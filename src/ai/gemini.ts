/**
 * Gemini REST API client — no SDK, direct fetch calls.
 *
 * Handles 5 distinct error modes:
 *   429 RESOURCE_EXHAUSTED  → exponential backoff, max 3 retries
 *   400 INVALID_ARGUMENT    → bad prompt, do not retry
 *   500 INTERNAL            → transient, suggest retry
 *   503 UNAVAILABLE         → service down, suggest retry
 *   empty candidates[]      → SAFETY block, surface as content policy error
 */

import { buildCompetitorPrompt, buildDiscoveryPrompt, type AnalysisOutput, type DiscoveryOutput } from './prompts'
import type { NormalizedProfile } from '../lib/transformers'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
// Model precedence: env override → default. Update default here when Google deprecates.
// History: gemini-1.5-flash (retired) → gemini-2.0-flash (retired) → gemini-2.5-flash (current)
const MODEL = import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-2.5-flash'

// ----- Error class -----

export type GeminiErrorCode =
  | 'RATE_LIMITED'
  | 'INVALID_PROMPT'
  | 'INTERNAL_ERROR'
  | 'UNAVAILABLE'
  | 'SAFETY_BLOCK'
  | 'PARSE_ERROR'
  | 'UNKNOWN'

export class GeminiError extends Error {
  code: GeminiErrorCode
  retryable: boolean

  constructor(code: GeminiErrorCode, message: string, retryable: boolean) {
    super(message)
    this.name = 'GeminiError'
    this.code = code
    this.retryable = retryable
  }
}

// ----- Raw Gemini response types -----

interface GeminiPart {
  text: string
  /** Gemini 2.5 Flash returns thought parts (internal reasoning) alongside output.
   *  Filter these out — they are not the JSON response. */
  thought?: boolean
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[]
  }
  /** STOP = normal completion. MAX_TOKENS = truncated output = invalid JSON. */
  finishReason: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  error?: {
    code: number
    message: string
    status: string
  }
}

// ----- Core fetch with retry -----

async function callGemini(
  apiKey: string,
  prompt: string,
  signal?: AbortSignal,
  attempt = 0,
): Promise<string> {
  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,       // low temp = more consistent JSON output
        maxOutputTokens: 16384, // 8192 can truncate with 50-80 candidate pool + verbose rationales
        responseMimeType: 'application/json',
        // responseSchema constrains output at generation time — prevents Gemini from adding
        // JSON comments, extra fields, or malformed tokens that would break JSON.parse.
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
    signal,
  })

  // Handle HTTP-level errors
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { code: res.status, message: res.statusText, status: 'UNKNOWN' } })) as GeminiResponse

    const status = body.error?.status ?? ''

    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') {
      if (attempt < 3) {
        const backoff = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
        await sleep(backoff)
        return callGemini(apiKey, prompt, signal, attempt + 1)
      }
      throw new GeminiError('RATE_LIMITED', 'Gemini API rate limit exceeded after 3 retries.', false)
    }

    if (res.status === 400 || status === 'INVALID_ARGUMENT') {
      throw new GeminiError('INVALID_PROMPT', `Bad prompt: ${body.error?.message}`, false)
    }

    if (res.status === 500 || status === 'INTERNAL') {
      throw new GeminiError('INTERNAL_ERROR', 'Gemini internal error. Try again in a moment.', true)
    }

    if (res.status === 503 || status === 'UNAVAILABLE') {
      throw new GeminiError('UNAVAILABLE', 'Gemini service temporarily unavailable.', true)
    }

    throw new GeminiError('UNKNOWN', `Unexpected Gemini error: ${res.status} ${body.error?.message}`, true)
  }

  const json = (await res.json()) as GeminiResponse

  // Safety block: empty candidates array
  if (!json.candidates || json.candidates.length === 0) {
    throw new GeminiError(
      'SAFETY_BLOCK',
      'Gemini blocked the response (content policy). Try rephrasing the input handles.',
      false,
    )
  }

  const candidate = json.candidates[0]

  // Gemini 2.5 Flash includes thought parts (internal reasoning) in the response.
  // Skip them — only join parts where thought !== true to get the actual JSON output.
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')

  // MAX_TOKENS means the model stopped mid-output — JSON will be truncated and unparseable.
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new GeminiError(
      'PARSE_ERROR',
      'Gemini response was cut off (MAX_TOKENS). This should not happen at 8192 tokens — report this.',
      false,
    )
  }

  if (!text) {
    throw new GeminiError('SAFETY_BLOCK', 'Gemini returned an empty response.', false)
  }

  return text
}

// ----- Parse Gemini JSON output -----

function parseAnalysisOutput(raw: string): AnalysisOutput {
  // Strip markdown code fences if present (some models add them despite responseMimeType)
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as AnalysisOutput
    if (!parsed.competitors || !Array.isArray(parsed.competitors)) {
      throw new Error('Missing competitors array')
    }
    return parsed
  } catch (err) {
    throw new GeminiError(
      'PARSE_ERROR',
      `Could not parse Gemini response as JSON: ${(err as Error).message}`,
      false,
    )
  }
}

// ----- Public API -----

/**
 * Run competitor analysis using Gemini.
 * Takes normalized profiles, builds prompt with live taxonomy, returns structured output.
 *
 * @param nicheContext  Strategist-provided niche description (optional). Injected into
 *                      the prompt as an EXPLICIT NICHE CONTEXT block that improves filtering accuracy.
 */
export async function analyzeCompetitors(
  geminiKey: string,
  inputProfiles: NormalizedProfile[],
  candidateProfiles: NormalizedProfile[],
  signal?: AbortSignal,
  nicheContext?: string,
): Promise<AnalysisOutput> {
  const prompt = buildCompetitorPrompt(inputProfiles, candidateProfiles, nicheContext)
  const raw = await callGemini(geminiKey, prompt, signal)
  return parseAnalysisOutput(raw)
}

// ----- Discovery analysis -----

/** Parse Gemini JSON for the discovery output shape */
function parseDiscoveryOutput(raw: string): DiscoveryOutput {
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as DiscoveryOutput
    if (!parsed.results || !Array.isArray(parsed.results)) {
      throw new Error('Missing results array')
    }
    return parsed
  } catch (err) {
    throw new GeminiError(
      'PARSE_ERROR',
      `Could not parse Gemini discovery response: ${(err as Error).message}`,
      false,
    )
  }
}

/**
 * Run location discovery analysis using Gemini.
 * Takes normalized candidate profiles + city/niche context, returns DiscoveryOutput.
 *
 * @param creatorCount  Number of creator-scored profiles in candidateProfiles (optional).
 *                      When provided, injected into the prompt as a pool composition hint.
 * @param businessCount Number of business profiles in candidateProfiles (optional).
 */
export async function analyzeDiscovery(
  geminiKey: string,
  city: string,
  niche: string,
  candidateProfiles: NormalizedProfile[],
  signal?: AbortSignal,
  creatorCount?: number,
  businessCount?: number,
): Promise<DiscoveryOutput> {
  const prompt = buildDiscoveryPrompt(city, niche, candidateProfiles, creatorCount, businessCount)

  // Use callGemini with a discovery-specific responseSchema
  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${geminiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            niche: { type: 'string' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  username: { type: 'string' },
                  category: { type: 'string', enum: ['top', 'trending'] },
                  rank: { type: 'integer' },
                  rationale: { type: 'string' },
                  specialties: { type: 'array', items: { type: 'string' } },
                  contentFocus: { type: 'string' },
                  partnershipReady: { type: 'boolean' },
                  locationConfidence: { type: 'string', enum: ['confirmed', 'likely', 'unknown'] },
                },
                required: ['username', 'category', 'rank', 'rationale', 'specialties', 'contentFocus', 'partnershipReady', 'locationConfidence'],
              },
            },
          },
          required: ['niche', 'results'],
        },
      },
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { code: res.status, message: res.statusText, status: 'UNKNOWN' } })) as { error?: { code: number; message: string; status: string } }
    const status = body.error?.status ?? ''
    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') {
      throw new GeminiError('RATE_LIMITED', 'Gemini API rate limit exceeded.', false)
    }
    if (res.status === 400 || status === 'INVALID_ARGUMENT') {
      throw new GeminiError('INVALID_PROMPT', `Bad prompt: ${body.error?.message}`, false)
    }
    throw new GeminiError('UNKNOWN', `Gemini error: ${res.status} ${body.error?.message}`, true)
  }

  const json = (await res.json()) as { candidates?: Array<{ content: { parts: Array<{ text: string; thought?: boolean }> }; finishReason: string }> }
  if (!json.candidates || json.candidates.length === 0) {
    throw new GeminiError('SAFETY_BLOCK', 'Gemini blocked the response.', false)
  }

  const candidate = json.candidates[0]
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')

  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new GeminiError('PARSE_ERROR', 'Gemini response was cut off (MAX_TOKENS).', false)
  }

  if (!text) throw new GeminiError('SAFETY_BLOCK', 'Gemini returned empty response.', false)

  return parseDiscoveryOutput(text)
}

// ----- Utilities -----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
