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

import { buildCompetitorPrompt, buildDiscoveryPrompt, buildClarificationPrompt, buildContentPrompt, type AnalysisOutput, type DiscoveryOutput, type ClarificationQuestion, type ContentContext } from './prompts'
import type { NormalizedProfile } from '../lib/transformers'
import type { PreferenceExemplars } from '../lib/corpus'
import { pickGeminiKey, markGeminiKeyCooldown, hasFreshGeminiKey } from '../lib/geminiKeyRotator'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
// Model precedence: env override → default. Update default here when Google deprecates.
// History: gemini-1.5-flash (retired) → gemini-2.0-flash (retired) → gemini-2.5-flash (current)
const MODEL = import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-2.5-flash'

/**
 * Shared request headers for every Gemini REST call.
 *
 * SECURITY: the API key is sent via the `x-goog-api-key` header, NOT the
 * `?key=` query param. URLs leak into browser history, the devtools Network
 * tab, disk cache, extension hooks, and proxy/referrer logs — and in a
 * browser-only app the user's own key is the only secret. Headers don't leak
 * that way. Gemini supports both; we use the header everywhere.
 */
export function geminiHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
}

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
  text?: string
  /** Gemini 2.5 Flash returns thought parts (internal reasoning) alongside output.
   *  Filter these out — they are not the JSON response. */
  thought?: boolean
  /** Present when the model calls a tool (function-calling mode). */
  functionCall?: { name: string; args?: Record<string, unknown> }
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

// ----- Shared low-level helpers (used by every Gemini call) -----

/** True if a non-OK Gemini response is a rate-limit (429 / RESOURCE_EXHAUSTED). */
function isRateLimited(httpStatus: number, body: GeminiResponse): boolean {
  return httpStatus === 429 || body.error?.status === 'RESOURCE_EXHAUSTED'
}

/**
 * Map a non-OK, NON-429 Gemini response to a GeminiError. 429 is control flow
 * (retry vs throw) and is handled by each caller BEFORE calling this. Messages are
 * preserved verbatim from the original inline handlers so existing tests still pass.
 */
function mapGeminiHttpError(httpStatus: number, body: GeminiResponse): GeminiError {
  const status = body.error?.status ?? ''
  const msg = body.error?.message ?? ''
  if (httpStatus === 400 || status === 'INVALID_ARGUMENT') {
    return new GeminiError('INVALID_PROMPT', `Bad prompt: ${msg}`, false)
  }
  if (httpStatus === 500 || status === 'INTERNAL') {
    return new GeminiError('INTERNAL_ERROR', 'Gemini internal error. Try again in a moment.', true)
  }
  if (httpStatus === 503 || status === 'UNAVAILABLE') {
    return new GeminiError('UNAVAILABLE', 'Gemini service temporarily unavailable.', true)
  }
  const isAuth =
    httpStatus === 401 ||
    status === 'UNAUTHENTICATED' ||
    status === 'PERMISSION_DENIED' ||
    msg.toLowerCase().includes('api key')
  if (isAuth) {
    return new GeminiError('AUTH_ERROR', 'Invalid Gemini API key. Check VITE_GEMINI_KEY in .env.', false)
  }
  return new GeminiError('UNKNOWN', `Unexpected Gemini error: ${httpStatus} ${msg}`, true)
}

/** Join a candidate's text parts, filtering out 2.5-Flash thought parts. */
function joinThoughtFilteredText(parts: GeminiPart[] | undefined): string {
  return (parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
}

// ----- Key rotation + generate (shared by every Gemini call) -----

/** Exponential backoff with jitter (ms), honoring a Retry-After header (seconds) when present. */
function geminiBackoffMs(attempt: number, retryAfter: string | null): number {
  const ra = retryAfter ? Number(retryAfter) : NaN
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 8000) + Math.random() * 250
  return Math.min(Math.pow(2, attempt) * 1000, 8000) + Math.random() * 500 // ~1s,2s,4s,8s + jitter
}

/**
 * POST to Gemini generateContent with KEY ROTATION + 429 failover.
 *
 * Picks a round-robin key from the pool per attempt (spreads concurrent multi-user load so no
 * single key's RPM/TPM is the bottleneck). On 429 / RESOURCE_EXHAUSTED it cools that key (60s)
 * and fails over to a fresh key immediately, or backs off (jittered, honoring Retry-After) when
 * every key is cooling down. Returns the parsed response for any non-rate-limit outcome — the
 * caller maps non-OK via mapGeminiHttpError and parses candidates.
 *
 * Accepts a single key (back-compat) or a pool; a single key still gets backoff/retry, a pool
 * additionally rotates + fails over. This is the ONE place 429s + rotation are handled, so every
 * caller (schema / content / tools / intent / hashtags) inherits multi-user resilience.
 */
export async function geminiGenerate(
  apiKeys: string | string[],
  requestBody: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; json: GeminiResponse }> {
  const pool = (Array.isArray(apiKeys) ? apiKeys : [apiKeys]).map((k) => k.trim()).filter(Boolean)
  if (pool.length === 0) {
    throw new GeminiError('AUTH_ERROR', 'No Gemini API key configured — set VITE_GEMINI_KEY or VITE_GEMINI_KEYS.', false)
  }
  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent`
  const maxAttempts = Math.max(3, pool.length) + 1

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const picked = pickGeminiKey(pool)! // pool non-empty → never null
    const res = await fetch(url, {
      method: 'POST',
      headers: geminiHeaders(picked.key),
      body: JSON.stringify(requestBody),
      signal,
    })
    const json = (await res.json().catch(() => ({
      error: { code: res.status, message: res.statusText, status: 'UNKNOWN' },
    }))) as GeminiResponse

    if (!isRateLimited(res.status, json)) return { ok: res.ok, status: res.status, json }

    markGeminiKeyCooldown(picked.key) // route the next pick around this just-limited key
    if (attempt >= maxAttempts - 1) break
    // Fail over to a fresh key immediately; back off only when the whole pool is cooling down.
    const wait = hasFreshGeminiKey(pool) ? 0 : geminiBackoffMs(attempt, res.headers?.get('retry-after') ?? null)
    if (wait > 0) await abortableSleep(wait, signal)
  }
  throw new GeminiError('RATE_LIMITED', 'Gemini API rate limit exceeded after retries across all keys.', false)
}

// ----- Generic schema-constrained Gemini call -----

/**
 * Low-level helper for all JSON-mode Gemini calls. Builds + POSTs with a caller-supplied
 * responseSchema through geminiGenerate (key rotation + 429 failover), filters thought parts,
 * handles MAX_TOKENS + safety blocks, and JSON-parses the result as T.
 *
 * @param apiKeys A single key (back-compat) or the rotation pool (keysStore.geminiKeys).
 */
export async function callGeminiWithSchema<T>(
  apiKeys: string | string[],
  prompt: string,
  schema: Record<string, unknown>,          // responseSchema object
  options?: {
    temperature?: number                    // default: 0.3
    maxOutputTokens?: number               // default: 8192
    thinkingBudget?: number               // when set, adds thinkingConfig
    signal?: AbortSignal
  },
): Promise<T> {
  const { temperature = 0.3, maxOutputTokens = 8192, thinkingBudget, signal } = options ?? {}

  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: schema,
  }
  if (thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget }

  const { ok, status, json } = await geminiGenerate(
    apiKeys,
    { contents: [{ parts: [{ text: prompt }] }], generationConfig },
    signal,
  )
  if (!ok) throw mapGeminiHttpError(status, json)

  // Safety block: empty candidates array
  if (!json.candidates || json.candidates.length === 0) {
    throw new GeminiError(
      'SAFETY_BLOCK',
      'Gemini blocked the response (content policy). Try rephrasing the input handles.',
      false,
    )
  }

  const candidate = json.candidates[0]
  const text = joinThoughtFilteredText(candidate.content?.parts)

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

export const DISCOVERY_SCHEMA = {
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

// ----- Post-parse validation helpers -----

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
  geminiKey: string | string[],
  inputProfiles: NormalizedProfile[],
  candidateProfiles: NormalizedProfile[],
  signal?: AbortSignal,
  nicheContext?: string,
  clarificationAnswer?: string,
  preferenceExemplars?: PreferenceExemplars,
): Promise<AnalysisOutput> {
  const prompt = buildCompetitorPrompt(inputProfiles, candidateProfiles, nicheContext, clarificationAnswer, preferenceExemplars)
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
  geminiKey: string | string[],
  city: string,
  niche: string,
  candidateProfiles: NormalizedProfile[],
  signal?: AbortSignal,
  creatorCount?: number,
  businessCount?: number,
  preferenceExemplars?: PreferenceExemplars,
): Promise<DiscoveryOutput> {
  const prompt = buildDiscoveryPrompt(city, niche, candidateProfiles, creatorCount, businessCount, preferenceExemplars)
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
 * Uses callGeminiWithSchema with thinkingBudget: 0 (simple classification task —
 * no extended reasoning needed, saves 2–8s).
 *
 * NEVER throws to the caller — always returns a valid question.
 * On any error (network, parse, safety block) returns a safe generic fallback
 * so the analysis pipeline never halts due to this optional step.
 */
export async function generateClarificationQuestion(
  geminiKey: string | string[],
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

// ----- Content copilot response -----

/**
 * Conversational content-assistant turn. Powers the chat's "copilot" mode:
 * answers content/strategy questions and GENERATES content (hooks, captions,
 * scripts, ideas) as prose — no JSON schema. When research context is supplied
 * (a completed competitor/discovery run or reel synthesis), the prompt grounds
 * the answer in it so e.g. "write hooks" reuses the winning archetypes found.
 *
 * @param geminiKey   Active Gemini API key.
 * @param userMessage The user's message (already sanitized by sendMessage).
 * @param context     Optional research grounding (summary, accounts, hook patterns).
 * @param signal      AbortController signal.
 * @returns           Gemini's prose response (markdown bold/lists allowed).
 */
export async function callGeminiContent(
  apiKeys: string | string[],
  userMessage: string,
  context?: ContentContext,
  signal?: AbortSignal,
): Promise<string> {
  const fullPrompt = buildContentPrompt(userMessage, context)

  // Routes through geminiGenerate, so the copilot turn now gets the SAME key rotation + 429
  // failover as everything else (it previously had no retry at all — instant fail under load).
  const { ok, status, json } = await geminiGenerate(
    apiKeys,
    {
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: 0.7,       // natural, conversational copywriting tone
        maxOutputTokens: 1024,  // content generation (hook lists, scripts) runs longer
      },
    },
    signal,
  )

  if (!ok) throw mapGeminiHttpError(status, json)

  if (!json.candidates || json.candidates.length === 0) {
    throw new GeminiError('SAFETY_BLOCK', 'Gemini blocked the follow-up response.', false)
  }

  const text = joinThoughtFilteredText(json.candidates[0].content?.parts).trim()

  if (!text) {
    throw new GeminiError('SAFETY_BLOCK', 'Gemini returned an empty follow-up response.', false)
  }

  return text
}

// ----- Function-calling primitive (Phase 1b agent loop) -----

/** One tool the model may call. `parameters` is a JSON-Schema object (Gemini's OpenAPI subset). */
export interface GeminiFunctionDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** A conversation turn in Gemini's `contents` format. */
export interface GeminiTurn {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/** Result of one agent turn: the model either CALLS a tool or REPLIES with text. */
export type GeminiToolResult =
  | { kind: 'call'; name: string; args: Record<string, unknown> }
  | { kind: 'text'; text: string }

/**
 * Function-calling turn for the Phase-1b agent loop. Sends the conversation + the
 * available tools; the model decides to CALL a tool or REPLY with text (e.g. a
 * clarifying question). Returns a discriminated result — the loop dispatches calls
 * and renders text.
 *
 * Transport only: arg-schema validation + the malformed-call repair loop live in the
 * agent loop (T8), where per-tool Zod schemas exist. 429 is retried with abort-aware
 * backoff (max 3); other HTTP errors map via the shared mapGeminiHttpError.
 */
export async function callGeminiWithTools(
  apiKeys: string | string[],
  contents: GeminiTurn[],
  tools: GeminiFunctionDeclaration[],
  options?: { temperature?: number; thinkingBudget?: number; signal?: AbortSignal; systemInstruction?: string },
): Promise<GeminiToolResult> {
  const { temperature = 0.3, thinkingBudget, signal, systemInstruction } = options ?? {}

  const generationConfig: Record<string, unknown> = { temperature }
  if (thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget }

  const reqBody: Record<string, unknown> = {
    contents,
    tools: [{ functionDeclarations: tools }],
    generationConfig,
  }
  if (systemInstruction) reqBody.systemInstruction = { parts: [{ text: systemInstruction }] }

  // geminiGenerate handles key rotation + 429 retry/failover; non-429 errors + parsing stay here.
  const { ok, status, json } = await geminiGenerate(apiKeys, reqBody, signal)

  if (!ok) {
    // Diagnostic (console only — raw body is NEVER shown to the user, per C2/H11).
    console.error('[gemini:tools] HTTP error', status, json.error?.status, json.error?.message)
    throw mapGeminiHttpError(status, json)
  }

  if (!json.candidates || json.candidates.length === 0) {
    console.error('[gemini:tools] blocked / no candidates', json)
    throw new GeminiError('SAFETY_BLOCK', 'Gemini blocked the response (content policy).', false)
  }

  const candidate = json.candidates[0]
  // Known intermittent function-calling hiccup: the model attempts a tool call but malforms
  // it, so the candidate comes back with finishReason MALFORMED_FUNCTION_CALL and (usually)
  // no usable parts. Treat it as a retryable parse error, NOT a content-policy "decline".
  if (candidate.finishReason === 'MALFORMED_FUNCTION_CALL') {
    console.error('[gemini:tools] malformed function call', candidate.finishReason)
    throw new GeminiError('PARSE_ERROR', 'Gemini returned a malformed function call.', true)
  }

  const parts = candidate.content?.parts ?? []
  // Prefer a tool call if the model emitted one; otherwise fall back to text.
  const call = parts.find((p) => p.functionCall)?.functionCall
  if (call?.name) {
    return { kind: 'call', name: call.name, args: call.args ?? {} }
  }
  const text = joinThoughtFilteredText(parts).trim()
  if (!text) {
    console.error('[gemini:tools] empty output', candidate.finishReason)
    throw new GeminiError('SAFETY_BLOCK', 'Gemini returned neither a tool call nor text.', false)
  }
  return { kind: 'text', text }
}

// ----- Utilities -----

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  // M8: a 429 backoff (up to 4s) must be interruptible — otherwise abort() during the
  // wait still fires the retry into a dead signal. Reject on abort instead.
  if (signal?.aborted) return Promise.reject(new GeminiError('UNKNOWN', 'Aborted during backoff', false))
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new GeminiError('UNKNOWN', 'Aborted during backoff', false))
    }, { once: true })
  })
}
