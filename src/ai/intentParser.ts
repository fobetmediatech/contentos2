/**
 * Intent parser — converts free-form user messages into structured ParsedIntent.
 *
 * Uses Gemini with buildIntentPrompt() and validates the response with Zod.
 * Zod validation is the safety net: Gemini JSON mode is best-effort, so the
 * schema can still return wrong types or missing required fields.
 *
 * Returns one of:
 *   { needsClarification: true, question: string }
 *   { needsClarification: false, niche, location?, knownHandles, depth, clientName? }
 *
 * On parse or validation failure, retries once with error context injected,
 * then throws GeminiError if the retry also fails.
 */

import { z } from 'zod'
import { buildIntentPrompt } from './prompts'
import { GeminiError, geminiHeaders } from './gemini'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-2.5-flash'

// ── Zod schema (T1: schema validation) ──────────────────────────────────────
//
// All optional fields use .nullish() (not just .optional()) because Gemini JSON
// mode returns null for absent fields, not undefined — .optional() rejects null.

const ClarificationSchema = z.object({
  needsClarification: z.literal(true),
  question: z.string().min(1).max(300),
})

const IntentSchema = z.object({
  // Gemini may return null when no clarification is needed — treat as false.
  needsClarification: z.union([z.literal(false), z.null(), z.undefined()]).nullish(),
  // niche is OPTIONAL: Gemini correctly omits it for handle-driven requests
  // ("compare @a and @b", "break down @x's reels") where the handles ARE the target.
  // The .refine() below enforces niche-OR-handles so a resolved intent is never empty.
  niche: z.string().max(100).nullish().default('').transform((s) => (s ?? '').trim()),
  location: z.string().max(50).nullish().transform((s) => s?.trim() || undefined),
  // Gemini often returns null for an empty array — normalise to [].
  knownHandles: z
    .array(z.string())
    .max(5)
    .nullish()
    .default([])
    .transform((arr) => (arr ?? []).map((h) => h.replace(/^@/, '').toLowerCase().trim()).filter(Boolean)),
  depth: z.enum(['standard', 'deep']).nullish().default('standard'),
  clientName: z.string().max(100).nullish().transform((s) => s?.trim() || undefined),
  // Routes the intent to the correct pipeline.
  // 'discovery' = user wants creators geographically located in a city.
  // 'competitor' = user wants to find who's succeeding in a niche (default).
  // .transform() coerces null → 'competitor' because .default() only fires for
  // undefined, not null — and Gemini JSON mode returns null for absent fields.
  // .catch('competitor') gracefully handles null, undefined, and unknown enum
  // values (e.g. 'location') without triggering the validation-retry path.
  pipelineType: z
    .enum(['competitor', 'discovery', 'reel', 'content'])
    .catch('competitor'),
  // How confident Gemini is about the pipeline routing decision.
  // 'high' = clear from the message; 'medium' = judgment call or ambiguous.
  // Must use .catch() (not .nullish().default()) because Gemini JSON mode
  // returns null for absent fields and .default() only fires for undefined.
  routingConfidence: z
    .enum(['high', 'medium'])
    .catch('high'),
})
  // Only competitor/discovery SEARCHES need a target (a niche or handles) — an empty one
  // would dispatch a garbage hashtag search. A `reel` intent resolves handle-less (the
  // orchestrator then asks which creators), and a `content` intent acts on the message
  // itself, so both are exempt. (Both exemptions were eval-caught: `content` with no
  // niche, and the earlier handle-only-no-niche case.)
  .refine(
    (d) =>
      (d.pipelineType !== 'competitor' && d.pipelineType !== 'discovery') ||
      d.niche.length > 0 ||
      d.knownHandles.length > 0,
    { message: 'a competitor/discovery search needs a niche or at least one handle', path: ['niche'] },
  )

const ParsedIntentSchema = z.union([ClarificationSchema, IntentSchema])

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>

// ── Gemini call ──────────────────────────────────────────────────────────────

const INTENT_RETRIES = 2          // max network-level retries
const INTENT_RETRY_DELAY_MS = 1500

/** One-shot Gemini call. Retry logic lives in callGeminiForIntent. */
async function fetchIntent(
  geminiKey: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: geminiHeaders(geminiKey),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        // responseSchema enforces JSON grammar at the token level — prevents unquoted keys,
        // trailing commas, and other malformed output that JSON.parse can't handle.
        // All fields are optional at the schema level; Zod validation enforces the
        // semantic invariants (e.g. niche is required when needsClarification is false).
        responseSchema: {
          type: 'object',
          properties: {
            needsClarification: { type: 'boolean' },
            question: { type: 'string' },
            niche: { type: 'string' },
            location: { type: 'string' },
            knownHandles: { type: 'array', items: { type: 'string' } },
            depth: { type: 'string', enum: ['standard', 'deep'] },
            clientName: { type: 'string' },
            pipelineType: { type: 'string', enum: ['competitor', 'discovery', 'reel', 'content'] },
            routingConfidence: { type: 'string', enum: ['high', 'medium'] },
          },
          required: ['needsClarification'],
        },
        // thinkingBudget: 0 disables internal reasoning for this deterministic
        // classification task. Only valid for gemini-2.5-* models — omit for others.
        ...(MODEL.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
    signal,
  })

  // Always parse the body so we can distinguish auth errors from 4xx failures.
  // Gemini returns 400 INVALID_ARGUMENT for bad/missing API keys (not 401).
  const json = await res.json().catch(() => null)

  if (!res.ok) {
    const status: string = json?.error?.status ?? ''
    const msg: string = json?.error?.message ?? ''
    const isAuthError =
      res.status === 401 ||
      status === 'UNAUTHENTICATED' ||
      status === 'PERMISSION_DENIED' ||
      msg.toLowerCase().includes('api key')
    if (isAuthError) {
      throw new GeminiError('AUTH_ERROR', 'Invalid Gemini API key. Check VITE_GEMINI_KEY in .env.', false)
    }
    throw new GeminiError(
      res.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN',
      `Intent parse failed: ${res.status} — ${msg || status}`,
      res.status >= 500,
    )
  }

  // Also handle inline error objects returned with 200 (edge case)
  if (json?.error?.code === 401 || json?.error?.status === 'UNAUTHENTICATED') {
    throw new GeminiError('AUTH_ERROR', 'Invalid Gemini API key. Check VITE_GEMINI_KEY in .env.', false)
  }

  const candidate = json?.candidates?.[0]
  if (!candidate) {
    throw new GeminiError('UNKNOWN', 'Gemini returned empty response for intent parsing', false)
  }

  // MAX_TOKENS means the model stopped mid-output — JSON will be truncated and unparseable.
  // Short-circuit before JSON.parse to give a clean error instead of a vague SyntaxError.
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new GeminiError('PARSE_ERROR', 'Intent response was truncated (MAX_TOKENS). Increase maxOutputTokens.', false)
  }

  const text = (candidate.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? '')
    .join('')

  if (!text) throw new GeminiError('UNKNOWN', 'Gemini returned empty intent response', false)

  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  return JSON.parse(cleaned)
}

/**
 * fetchIntent with up to INTENT_RETRIES network-level retries.
 * Only retries on transient errors (fetch failures, 5xx). Auth and rate-limit
 * errors are not retried — they need user action or backing off.
 */
async function callGeminiForIntent(
  geminiKey: string,
  userMessage: string,
  signal?: AbortSignal,
  retryNote?: string,
): Promise<unknown> {
  const prompt = buildIntentPrompt(userMessage, retryNote)
  let lastErr: unknown

  for (let attempt = 0; attempt <= INTENT_RETRIES; attempt++) {
    if (signal?.aborted) throw new GeminiError('UNKNOWN', 'Aborted', false)
    try {
      return await fetchIntent(geminiKey, prompt, signal)
    } catch (err) {
      lastErr = err
      // Don't retry deterministic errors — they won't heal:
      //   AUTH_ERROR → bad key, RATE_LIMITED → needs backoff, non-retryable non-UNKNOWN
      const isGemini = err instanceof GeminiError
      const isAuthOrRate = isGemini && (err.code === 'AUTH_ERROR' || err.code === 'RATE_LIMITED')
      const isNonRetryable = isGemini && !err.retryable && err.code !== 'UNKNOWN'
      if (isAuthOrRate || isNonRetryable || signal?.aborted) throw err
      if (attempt < INTENT_RETRIES) {
        console.warn(`[intentParser] attempt ${attempt + 1} failed, retrying in ${INTENT_RETRY_DELAY_MS}ms:`, err)
        // Abort-aware delay: if the component unmounts during the wait, we
        // cancel the timeout and stop the retry loop rather than firing a
        // ghost network call into a dead AbortSignal.
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, INTENT_RETRY_DELAY_MS)
          signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Aborted')) }, { once: true })
        })
      }
    }
  }

  // All retries exhausted
  if (lastErr instanceof GeminiError) throw lastErr
  // SyntaxError = Gemini returned malformed JSON (not a network failure).
  // Use PARSE_ERROR so useConversation shows the correct message.
  const isParse = lastErr instanceof SyntaxError
  throw new GeminiError(
    isParse ? 'PARSE_ERROR' : 'UNKNOWN',
    isParse ? `Gemini returned invalid JSON: ${String(lastErr)}` : `Network error: ${String(lastErr)}`,
    false,
  )
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a user's natural-language message into a structured intent.
 *
 * Retries once on JSON parse or Zod validation failure, injecting the error
 * context so Gemini can correct its output. Throws GeminiError on double failure.
 *
 * @param geminiKey  Active Gemini API key
 * @param userMessage  Raw message from the chat input (≤500 chars enforced in prompt)
 * @param signal  AbortController signal
 */
export async function parseIntent(
  geminiKey: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<ParsedIntent> {
  // callGeminiForIntent already retries up to INTENT_RETRIES times on network failures.
  const raw = await callGeminiForIntent(geminiKey, userMessage, signal)

  // First validation attempt
  const result = ParsedIntentSchema.safeParse(raw)
  if (result.success) return result.data

  // Retry once with error context (Zod or JSON shape mismatch)
  console.warn('[intentParser] validation failed, retrying:', result.error.message, 'raw:', raw)

  try {
    // M7: pass the ORIGINAL user message (escaped once inside buildIntentPrompt) plus a
    // SEPARATE structural retry note — never re-inject raw user text into a new prompt
    // body. The note carries only `path: code` pairs, never field values.
    const retryNote = `Previous response failed schema validation. Issues: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.code}`).join('; ')}. Respond with valid JSON only.`
    const retryRaw = await callGeminiForIntent(geminiKey, userMessage, signal, retryNote)
    const retryResult = ParsedIntentSchema.safeParse(retryRaw)
    if (retryResult.success) return retryResult.data

    throw new GeminiError('PARSE_ERROR', "Couldn't parse the intent after two attempts.", false)
  } catch (err) {
    if (err instanceof GeminiError) throw err
    throw new GeminiError('PARSE_ERROR', "Couldn't parse the intent after two attempts.", false)
  }
}
