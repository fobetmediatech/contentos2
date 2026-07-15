/**
 * Text→JSON Gemini call for server-side synthesis (voice-profile build). Mirrors
 * get-transcript's inline generateContent but with a text prompt + responseSchema.
 */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const GEMINI_MODEL = 'gemini-2.5-flash'

/** Mirrors GeminiTextError (geminiText.ts) so callers can distinguish HTTP failures
 *  from parse failures instead of catching an unlabeled Error/SyntaxError. */
export class GeminiJsonError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GeminiJsonError'
    this.status = status
  }
}

/** GEMINI_API_KEY + GEMINI_KEYS (comma-separated), random pick. */
export function pickGeminiKey(): string {
  const keys = [
    ...String(process.env.GEMINI_API_KEY ?? '').split(','),
    ...String(process.env.GEMINI_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
  return keys[Math.floor(Math.random() * keys.length)] ?? ''
}

/** Generate a JSON object from a text prompt + response schema. Throws GeminiJsonError on failure. */
export async function geminiGenerateJson(prompt: string, schema: unknown, apiKey: string): Promise<unknown> {
  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new GeminiJsonError(`Gemini synthesis failed (${res.status})`, res.status)
  const parsed = JSON.parse(text) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text
  if (!out) throw new GeminiJsonError('Gemini returned no content', 502)
  try {
    return JSON.parse(out) as unknown
  } catch {
    // A real failure mode (MAX_TOKENS / safety filtering can truncate output despite
    // responseSchema) — surface a labeled error instead of a raw, unattributed SyntaxError.
    throw new GeminiJsonError('Gemini returned malformed JSON', 502)
  }
}
