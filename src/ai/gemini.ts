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

import { buildCompetitorPrompt, buildDiscoveryPrompt, buildClarificationPrompt, buildFollowUpContext, buildConfirmReplyPrompt, type AnalysisOutput, type DiscoveryOutput, type ClarificationQuestion } from './prompts'
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
  | 'AUTH_ERROR'
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

// ----- Generic schema-constrained Gemini call with retry -----

/**
 * Low-level helper for all JSON-mode Gemini calls.
 *
 * Builds and POSTs to Gemini with a caller-supplied responseSchema, applies
 * 3-attempt exponential backoff on 429, filters thought parts, handles
 * MAX_TOKENS and safety blocks, and JSON-parses the result as T.
 *
 * Use this for every structured-output call. For plain-text output
 * (conversational follow-ups) keep using direct fetch — see callGeminiFollowUp.
 */
export async function callGeminiWithSchema<T>(
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,          // responseSchema object
  options?: {
    temperature?: number                    // default: 0.3
    maxOutputTokens?: number               // default: 8192
    thinkingBudget?: number               // when set, adds thinkingConfig
    signal?: AbortSignal
  },
  attempt = 0,
): Promise<T> {
  const {
    temperature = 0.3,
    maxOutputTokens = 8192,
    thinkingBudget,
    signal,
  } = options ?? {}

  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${apiKey}`

  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: schema,
  }

  if (thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
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
        return callGeminiWithSchema<T>(apiKey, prompt, schema, options, attempt + 1)
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

    // Auth error detection (mirrors callGeminiFollowUp pattern)
    const isAuthError =
      res.status === 401 ||
      status === 'UNAUTHENTICATED' ||
      status === 'PERMISSION_DENIED' ||
      (body.error?.message ?? '').toLowerCase().includes('api key')
    if (isAuthError) {
      throw new GeminiError('AUTH_ERROR', 'Invalid Gemini API key. Check Settings.', false)
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

  // Strip markdown code fences if present (some models add them despite responseMimeType)
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  try {
    return JSON.parse(cleaned) as T
  } catch (err) {
    throw new GeminiError(
      'PARSE_ERROR',
      `Could not parse Gemini response as JSON: ${(err as Error).message}`,
      false,
    )
  }
}

// ----- Competitor analysis schema -----

const COMPETITOR_SCHEMA = {
  type: 'object',
  properties: {
    derivedNiche: { type: 'string' },
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
}

// ----- Discovery analysis schema -----

const DISCOVERY_SCHEMA = {
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
}

// ----- Parse helpers (post-processing after JSON parse) -----

function validateAnalysisOutput(parsed: AnalysisOutput): AnalysisOutput {
  if (!parsed.competitors || !Array.isArray(parsed.competitors)) {
    throw new GeminiError('PARSE_ERROR', 'Missing competitors array', false)
  }
  return parsed
}

function coerceDiscoveryOutput(parsed: DiscoveryOutput): DiscoveryOutput {
  if (!parsed.results || !Array.isArray(parsed.results)) {
    throw new GeminiError('PARSE_ERROR', 'Missing results array', false)
  }
  // Coerce per-item fields: Gemini structured output can return null for array/string
  // fields even with responseSchema (best-effort enforcement). Defensive defaults here
  // prevent downstream crashes in DiscoveryCard and export functions.
  return {
    ...parsed,
    results: parsed.results.map((r) => ({
      ...r,
      rank: Number(r.rank) || 0,
      specialties: Array.isArray(r.specialties) ? r.specialties : [],
      contentFocus: r.contentFocus ?? '',
      rationale: r.rationale ?? '',
    })),
  }
}

// ----- Public API -----

/**
 * Run competitor analysis using Gemini.
 * Takes normalized profiles, builds prompt with live taxonomy, returns structured output.
 *
 * @param nicheContext          Strategist-provided niche description (optional). Injected into
 *                              the prompt as an EXPLICIT NICHE CONTEXT block that improves filtering accuracy.
 * @param clarificationAnswer   User's answer from the mid-run clarification card (optional).
 *                              When present and non-empty, injected as USER REFINEMENT to direct ranking.
 */
export async function analyzeCompetitors(
  geminiKey: string,
  inputProfiles: NormalizedProfile[],
  candidateProfiles: NormalizedProfile[],
  signal?: AbortSignal,
  nicheContext?: string,
  clarificationAnswer?: string,
): Promise<AnalysisOutput> {
  const prompt = buildCompetitorPrompt(inputProfiles, candidateProfiles, nicheContext, clarificationAnswer)
  const parsed = await callGeminiWithSchema<AnalysisOutput>(
    geminiKey,
    prompt,
    COMPETITOR_SCHEMA,
    { temperature: 0.3, maxOutputTokens: 16384, signal },
  )
  return validateAnalysisOutput(parsed)
}

// ----- Discovery analysis -----

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
  const parsed = await callGeminiWithSchema<DiscoveryOutput>(
    geminiKey,
    prompt,
    DISCOVERY_SCHEMA,
    { temperature: 0.3, maxOutputTokens: 16384, signal },
  )
  return coerceDiscoveryOutput(parsed)
}

// ----- Clarification question -----

/**
 * Generate a niche clarification question based on the discovered candidate pool.
 * Shown to the user before ranking so they can confirm which sub-niche direction
 * the tool should prioritize.
 *
 * Follows the analyzeDiscovery pattern — uses callGeminiWithSchema with its own responseSchema.
 * thinkingBudget: 0 (simple classification task — no extended reasoning needed, saves 2–8s).
 *
 * NEVER throws to the caller — always returns a valid question.
 * On any error (network, parse, safety block) returns a safe generic fallback
 * so the analysis pipeline never halts due to this optional step.
 */
export async function generateClarificationQuestion(
  geminiKey: string,
  referenceProfile: NormalizedProfile,
  candidates: NormalizedProfile[],
  nicheContext: string,
  signal?: AbortSignal,
): Promise<ClarificationQuestion> {
  const FALLBACK: ClarificationQuestion = {
    question: 'Which direction best fits your client?',
    options: [
      'Exact niche match — same content style and audience',
      'Broader category — adjacent creators are fine',
    ],
  }

  const CLARIFICATION_SCHEMA = {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
    },
    required: ['question', 'options'],
  }

  try {
    const prompt = buildClarificationPrompt(referenceProfile, candidates, nicheContext)
    const parsed = await callGeminiWithSchema<ClarificationQuestion>(
      geminiKey,
      prompt,
      CLARIFICATION_SCHEMA,
      { temperature: 0.3, thinkingBudget: 0, signal },
    )

    if (
      typeof parsed.question !== 'string' ||
      !Array.isArray(parsed.options) ||
      parsed.options.length < 2
    ) {
      return FALLBACK
    }

    return parsed
  } catch {
    return FALLBACK
  }
}

// ----- Follow-up prose response -----

/**
 * Send a free-form follow-up message to Gemini after a pipeline completes.
 *
 * Unlike the analysis functions, this call:
 *   - Uses plain text MIME (not JSON mode) — response is conversational prose.
 *   - Does NOT use responseSchema — no structured output needed.
 *   - Is intentionally simple: the system context from buildFollowUpContext()
 *     frames the conversation and the user message is appended directly.
 *
 * @param geminiKey        Active Gemini API key.
 * @param summary          Short description of what the completed pipeline found.
 *                         Injected via buildFollowUpContext() as system context.
 * @param userMessage      The user's follow-up message (already sanitized by sendMessage).
 * @param signal           AbortController signal.
 * @param accountSummaries Optional list of accounts found by the pipeline.
 *                         When provided, Gemini can reference specific accounts in its response.
 * @returns                Gemini's prose response (1–3 sentences).
 */
export async function callGeminiFollowUp(
  geminiKey: string,
  summary: string,
  userMessage: string,
  signal?: AbortSignal,
  accountSummaries?: Array<{ username: string; followers: number; er: number }>,
): Promise<string> {
  const systemContext = buildFollowUpContext(summary, accountSummaries)
  const fullPrompt = `${systemContext}\n\nUser: ${userMessage}`

  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${geminiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: 0.7,       // slightly higher for natural conversational tone
        maxOutputTokens: 256,   // prose follow-up is always short
      },
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as GeminiResponse
    const status = body.error?.status ?? ''
    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') {
      throw new GeminiError('RATE_LIMITED', 'Gemini rate limit hit — wait a moment and try again.', false)
    }
    const isAuthError =
      res.status === 401 ||
      status === 'UNAUTHENTICATED' ||
      status === 'PERMISSION_DENIED' ||
      (body.error?.message ?? '').toLowerCase().includes('api key')
    if (isAuthError) {
      throw new GeminiError('AUTH_ERROR', 'Invalid Gemini API key. Check Settings.', false)
    }
    throw new GeminiError('UNKNOWN', `Follow-up failed: ${res.status}`, true)
  }

  const json = (await res.json()) as GeminiResponse

  if (!json.candidates || json.candidates.length === 0) {
    throw new GeminiError('SAFETY_BLOCK', 'Gemini blocked the follow-up response.', false)
  }

  const candidate = json.candidates[0]
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim()

  if (!text) {
    throw new GeminiError('SAFETY_BLOCK', 'Gemini returned an empty follow-up response.', false)
  }

  return text
}

// ----- Confirm reply mapping -----

/**
 * Map a free-text confirming-state reply to one of the available pipeline option strings.
 *
 * Uses JSON mode at temperature 0 to deterministically select the best matching option.
 * Validates the returned string is actually in availableOptions — falls back to
 * availableOptions[0] if Gemini returns a near-miss or hallucinated string.
 *
 * @param geminiKey        Active Gemini API key.
 * @param userText         The user's free-text message (already sanitised — max 500 chars, newlines stripped).
 * @param availableOptions The exact option strings to choose between.
 * @param signal           AbortController signal.
 * @returns                One of availableOptions (guaranteed).
 */
export async function callGeminiConfirmReply(
  geminiKey: string,
  userText: string,
  availableOptions: string[],
  signal?: AbortSignal,
): Promise<string> {
  if (availableOptions.length === 0) return ''

  const prompt = buildConfirmReplyPrompt(userText, availableOptions)

  const CONFIRM_SCHEMA = {
    type: 'object',
    properties: {
      selectedOption: { type: 'string' },
    },
    required: ['selectedOption'],
  }

  let parsed: { selectedOption?: unknown; selected_option?: unknown; SelectedOption?: unknown }
  try {
    parsed = await callGeminiWithSchema<typeof parsed>(
      geminiKey,
      prompt,
      CONFIRM_SCHEMA,
      { temperature: 0, maxOutputTokens: 64, signal },
    )
  } catch (err) {
    // Safety block falls back to default; other errors are rethrown
    if (err instanceof GeminiError && err.code === 'SAFETY_BLOCK') {
      return availableOptions[0]
    }
    throw err
  }

  try {
    // Try camelCase key first (canonical schema), then fallback variants (snake_case,
    // PascalCase) in case different Gemini model variants return different key formats.
    const selected = String(
      parsed.selectedOption ?? parsed.selected_option ?? parsed.SelectedOption ?? '',
    )
    // Validate the returned string is an exact member of availableOptions.
    // This prevents near-miss hallucinations from corrupting downstream pipeline logic.
    if (availableOptions.includes(selected)) return selected
  } catch {
    // JSON parse failure — fall through to default
  }

  return availableOptions[0]
}

// ----- Utilities -----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
