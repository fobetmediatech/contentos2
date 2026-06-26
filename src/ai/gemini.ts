/**
 * Gemini REST API client — routes all calls through the /api/gemini server proxy.
 *
 * After Phase 1: API keys live on the server (never exposed in the browser bundle).
 * All calls go to POST /api/gemini with a Clerk Bearer token. The proxy handles
 * key selection, 429 failover, and model/endpoint allowlisting.
 *
 * Error handling is unchanged from the caller's perspective — non-OK responses
 * still map to GeminiError codes via mapGeminiHttpError.
 */

import { buildCompetitorPrompt, buildDiscoveryPrompt, buildClarificationPrompt, buildContentPrompt, type AnalysisOutput, type DiscoveryOutput, type ClarificationQuestion, type ContentContext } from './prompts'
import type { NormalizedProfile } from '../lib/transformers'
import type { PreferenceExemplars } from '../lib/corpus'
import { getClerkSessionToken } from '../lib/clerkToken'
import { devLog } from '../lib/devLog'

// Model used when building the proxy request. Still respects VITE_GEMINI_MODEL overrides
// (harmless VITE_ — this is just a model name, not a secret).
const MODEL = import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-2.5-flash'

// PREMIUM model for the high-leverage calls only — competitor ranking + the knowledge seed, where
// quality directly drives result relevance/recall. Defaults to MODEL, so behavior is UNCHANGED
// until VITE_GEMINI_PREMIUM_MODEL is set (e.g. 'gemini-3.5-flash'). This is the per-call split that
// captures a stronger model where it pays off without paying its price on every cheap routing call.
const PREMIUM_MODEL = import.meta.env.VITE_GEMINI_PREMIUM_MODEL ?? MODEL

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
  /** Present ONLY when Google Search grounding actually ran — used to confirm web search engaged. */
  groundingMetadata?: Record<string, unknown>
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  error?: {
    code: number
    message: string
    status: string
  }
}

// ----- Shared low-level helpers -----

/**
 * Map a non-OK Gemini response to a typed GeminiError.
 * Messages are preserved verbatim from the original handlers so existing tests still pass.
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
  if (httpStatus === 429 || status === 'RESOURCE_EXHAUSTED') {
    return new GeminiError('RATE_LIMITED', 'Gemini rate limit reached. Try again in a moment.', true)
  }
  const isAuth =
    httpStatus === 401 ||
    status === 'UNAUTHENTICATED' ||
    status === 'PERMISSION_DENIED' ||
    msg.toLowerCase().includes('api key')
  if (isAuth) {
    return new GeminiError('AUTH_ERROR', 'Invalid Gemini API key. Check GEMINI_API_KEY in the server environment.', false)
  }
  return new GeminiError('UNKNOWN', `Unexpected Gemini error: ${httpStatus} ${msg}`, true)
}

/** Join a candidate's text parts, filtering out 2.5-Flash thought parts. */
function joinThoughtFilteredText(parts: GeminiPart[] | undefined): string {
  return (parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
}

// ----- Proxy transport -----

/**
 * POST to the /api/gemini server proxy.
 *
 * The apiKeys parameter is kept for call-site compatibility but ignored — the proxy
 * selects keys server-side from process.env. Passes the Clerk session JWT so the
 * proxy can verify the caller is authenticated.
 */
export async function geminiGenerate(
  _apiKeys: string | string[],
  requestBody: Record<string, unknown>,
  signal?: AbortSignal,
  model: string = MODEL,
): Promise<{ ok: boolean; status: number; json: GeminiResponse }> {
  const clerkToken = await getClerkSessionToken()
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {}),
    },
    body: JSON.stringify({ model, body: requestBody }),
    signal,
  })
  const json = (await res.json().catch(() => ({
    error: { code: res.status, message: res.statusText, status: 'UNKNOWN' },
  }))) as GeminiResponse
  return { ok: res.ok, status: res.status, json }
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
    model?: string                         // override the proxy model (default: MODEL)
  },
): Promise<T> {
  const { temperature = 0.3, maxOutputTokens = 8192, thinkingBudget, signal, model } = options ?? {}

  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: schema,
  }
  if (thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget }

  const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig }
  // Retry once on retryable errors (500/503/429) with a short backoff.
  const MAX_ATTEMPTS = 2
  let lastOk = false
  let lastStatus = 0
  let lastJson: GeminiResponse = {}
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new GeminiError('UNKNOWN', 'Aborted', false)
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 1500))
    const result = await geminiGenerate(apiKeys, requestBody, signal, model)
    lastOk = result.ok; lastStatus = result.status; lastJson = result.json
    if (!result.ok) {
      const err = mapGeminiHttpError(result.status, result.json)
      if (err.retryable && attempt < MAX_ATTEMPTS - 1) continue
      throw err
    }
    break
  }
  if (!lastOk) throw mapGeminiHttpError(lastStatus, lastJson)

  // Safety block: empty candidates array
  if (!lastJson.candidates || lastJson.candidates.length === 0) {
    throw new GeminiError(
      'SAFETY_BLOCK',
      'Gemini blocked the response (content policy). Try rephrasing the input handles.',
      false,
    )
  }

  const candidate = lastJson.candidates[0]
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

// ----- Grounded JSON call (knowledge seed generator — Components A + B) -----

/** Extract a JSON array/object from grounded output that may carry prose or code fences. */
function stripToJson(text: string): string {
  let t = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
  const firstArr = t.indexOf('[')
  const firstObj = t.indexOf('{')
  const start = firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstArr, firstObj)
  if (start > 0) {
    const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'))
    if (end > start) t = t.slice(start, end + 1)
  }
  return t.trim()
}

/**
 * Gemini call WITH Google Search grounding (tools:[{googleSearch:{}}]) for recency.
 *
 * Gemini 2.5 FORBIDS responseSchema / responseMimeType:'application/json' together with the
 * googleSearch tool, so JSON cannot be structurally enforced here — the prompt must instruct JSON
 * and we parse the text defensively (grounded output often wraps JSON in prose + citations).
 * The /api/gemini proxy forwards the tools field verbatim; no server change is required.
 *
 * Throws GeminiError on transport/parse failure — the knowledge-seed caller catches and degrades
 * to an empty pool so a seed failure never aborts the whole discovery run.
 */
export async function callGeminiGroundedJson<T>(
  apiKeys: string | string[],
  prompt: string,
  options?: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal; model?: string },
): Promise<T> {
  // Knowledge-seed path → defaults to the PREMIUM model (the recall-critical call).
  const { temperature = 0.4, maxOutputTokens = 4096, signal, model = PREMIUM_MODEL } = options ?? {}
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature, maxOutputTokens },
  }
  const { ok, status, json } = await geminiGenerate(apiKeys, requestBody, signal, model)
  if (!ok) throw mapGeminiHttpError(status, json)
  if (!json.candidates || json.candidates.length === 0) {
    throw new GeminiError('SAFETY_BLOCK', 'Gemini blocked the grounded response.', false)
  }
  const candidate = json.candidates[0]
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new GeminiError('PARSE_ERROR', 'Grounded response was cut off (MAX_TOKENS).', false)
  }
  // Observability: groundingMetadata is present ONLY when web-search grounding actually engaged.
  // Its absence means web search silently did NOT activate (key entitlement / quota). Prod stays
  // quiet on the happy path (devLog is DEV-only) and warns loudly on the failure case. Logs only a
  // boolean — never the niche or the search queries (C3: research-target data never logs in prod).
  if (candidate.groundingMetadata) devLog('[grounding] web search active on grounded call')
  else console.warn('[grounding] web search did NOT activate on grounded call (Gemini key entitlement or quota?)')
  const text = joinThoughtFilteredText(candidate.content?.parts).trim()
  if (!text) throw new GeminiError('SAFETY_BLOCK', 'Gemini returned an empty grounded response.', false)
  try {
    return JSON.parse(stripToJson(text)) as T
  } catch (err) {
    throw new GeminiError('PARSE_ERROR', `Could not parse grounded response as JSON: ${(err as Error).message}`, false)
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
 * @param nicheBriefing         Web-grounded niche/sub-niche briefing from the knowledge-seed call
 *                              (optional). Injected as a WEB RESEARCH block — supports ranking with
 *                              current subniche/leaders/trends context; does NOT override the niche boundary.
 */
export async function analyzeCompetitors(
  geminiKey: string | string[],
  inputProfiles: NormalizedProfile[],
  candidateProfiles: NormalizedProfile[],
  signal?: AbortSignal,
  nicheContext?: string,
  clarificationAnswer?: string,
  preferenceExemplars?: PreferenceExemplars,
  corpusSignals?: Record<string, string>,
  mode: 'precise' | 'broad' = 'precise',
  nicheBriefing?: string,
): Promise<AnalysisOutput> {
  const prompt = buildCompetitorPrompt(inputProfiles, candidateProfiles, nicheContext, clarificationAnswer, preferenceExemplars, corpusSignals, mode, nicheBriefing)
  const parsed = await callGeminiWithSchema<AnalysisOutput>(
    geminiKey,
    prompt,
    COMPETITOR_SCHEMA,
    { temperature: 0.3, maxOutputTokens: 16384, signal, model: PREMIUM_MODEL },
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
  corpusSignals?: Record<string, string>,
): Promise<DiscoveryOutput> {
  const prompt = buildDiscoveryPrompt(city, niche, candidateProfiles, creatorCount, businessCount, preferenceExemplars, corpusSignals)
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
        thinkingConfig: { thinkingBudget: 0 },  // prose answer — no chain-of-thought needed
      },
    },
    signal,
  )

  if (!ok) throw mapGeminiHttpError(status, json)

  if (!json.candidates || json.candidates.length === 0) {
    throw new GeminiError('SAFETY_BLOCK', 'Gemini blocked the follow-up response.', false)
  }

  const candidate = json.candidates[0]

  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new GeminiError('PARSE_ERROR', 'Gemini response was cut off (MAX_TOKENS) — try a shorter request.', false)
  }

  const text = joinThoughtFilteredText(candidate.content?.parts).trim()

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

  // MALFORMED_FUNCTION_CALL is an intermittent Gemini hiccup: the model tries to emit a tool
  // call but malforms it (finishReason MALFORMED_FUNCTION_CALL, usually no usable parts). It
  // almost always clears on a retry, and thinking+tools is the common trigger — so retry a few
  // times and DROP thinking on the retries. Without this, a one-off malform surfaced a bare
  // "unexpected response" the user had to resend by hand (the resend is what fixed it).
  const MAX_MALFORMED_RETRIES = 2
  for (let attempt = 0; attempt <= MAX_MALFORMED_RETRIES; attempt++) {
    const generationConfig: Record<string, unknown> = { temperature }
    // Keep the thinking budget only on the first attempt; retries go thinking-free.
    if (thinkingBudget !== undefined && attempt === 0) generationConfig.thinkingConfig = { thinkingBudget }

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
    if (candidate.finishReason === 'MALFORMED_FUNCTION_CALL') {
      console.error(`[gemini:tools] malformed function call (attempt ${attempt + 1}/${MAX_MALFORMED_RETRIES + 1})`)
      if (attempt < MAX_MALFORMED_RETRIES) continue // retry — next attempt drops thinking
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

  // Unreachable: the loop either returns or throws on the final attempt. Satisfies the type checker.
  throw new GeminiError('PARSE_ERROR', 'Gemini returned a malformed function call.', true)
}

