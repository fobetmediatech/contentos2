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
import { GeminiError } from './gemini'

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
  niche: z.string().min(1).max(100).transform((s) => s.trim()),
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
})

const ParsedIntentSchema = z.union([ClarificationSchema, IntentSchema])

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>

// ── Gemini call ──────────────────────────────────────────────────────────────

async function callGeminiForIntent(
  geminiKey: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${geminiKey}`
  const prompt = buildIntentPrompt(userMessage)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
      },
    }),
    signal,
  })

  if (!res.ok) {
    await res.text().catch(() => '')
    throw new GeminiError(
      res.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN',
      `Intent parse failed: ${res.status}`,
      res.status >= 500,
    )
  }

  const json = await res.json()

  // Handle 401 — missing or invalid API key
  if (json.error?.code === 401 || json.error?.status === 'UNAUTHENTICATED') {
    throw new GeminiError('AUTH_ERROR', 'Invalid Gemini API key. Add your key in Settings.', false)
  }

  const candidate = json.candidates?.[0]
  if (!candidate) {
    throw new GeminiError('UNKNOWN', 'Gemini returned empty response for intent parsing', false)
  }

  const text = (candidate.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? '')
    .join('')

  if (!text) throw new GeminiError('UNKNOWN', 'Gemini returned empty intent response', false)

  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  return JSON.parse(cleaned)
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
  let raw: unknown

  try {
    raw = await callGeminiForIntent(geminiKey, userMessage, signal)
  } catch (err) {
    if (err instanceof GeminiError) throw err
    throw new GeminiError(`Intent parse network error: ${String(err)}`, 'UNKNOWN', 0)
  }

  // First validation attempt
  const result = ParsedIntentSchema.safeParse(raw)
  if (result.success) return result.data

  // Retry once with error context (Zod or JSON shape mismatch)
  console.warn('[intentParser] validation failed, retrying:', result.error.message, 'raw:', raw)

  try {
    const retryRaw = await callGeminiForIntent(
      geminiKey,
      `${userMessage}\n\n[Note: previous response failed validation: ${result.error.message}. Please fix and respond with valid JSON only.]`,
      signal,
    )
    const retryResult = ParsedIntentSchema.safeParse(retryRaw)
    if (retryResult.success) return retryResult.data

    throw new GeminiError('PARSE_ERROR', "Couldn't parse the intent after two attempts.", false)
  } catch (err) {
    if (err instanceof GeminiError) throw err
    throw new GeminiError('PARSE_ERROR', "Couldn't parse the intent after two attempts.", false)
  }
}
