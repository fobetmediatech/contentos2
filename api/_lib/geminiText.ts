/**
 * Server-side text-only Gemini generateContent (SERVER-SIDE, ESM, self-contained).
 *
 * Used by the single-reel synthesis stage: no video, just a systemInstruction + a JSON
 * user payload → a markdown case study string. Distinct from geminiFiles.ts (multimodal,
 * responseSchema/JSON). Never leaks the API key in error messages.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-2.5-flash'

export class GeminiTextError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GeminiTextError'
    this.status = status
  }
}

export interface GenerateMarkdownArgs {
  systemPrompt: string
  userPayload: string
  apiKey: string
  model?: string
  temperature?: number
}

export async function geminiGenerateMarkdown(args: GenerateMarkdownArgs): Promise<string> {
  const { systemPrompt, userPayload, apiKey } = args
  const model = args.model ?? DEFAULT_MODEL
  const temperature = args.temperature ?? 0.4

  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPayload }] }],
      generationConfig: { temperature },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new GeminiTextError(`generateContent failed (${res.status})`, res.status)

  const parsed = JSON.parse(text) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!out.trim()) throw new GeminiTextError('generateContent returned empty markdown', 502)
  return out
}
