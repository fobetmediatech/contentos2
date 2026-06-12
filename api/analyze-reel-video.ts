/**
 * POST /api/analyze-reel-video  — Vercel serverless function (Node / Fluid Compute).
 *
 * The ONE backend piece of the reel-intelligence feature. The browser cannot do the
 * Gemini Files API binary-video upload, so this function:
 *   gate(Clerk session JWT, verified server-side) -> allowlist the fetch host (SSRF
 *   guard) -> fetch(downloadedVideoUrl) bytes -> Gemini multimodal (Files API) ->
 *   DeepReelAnalysis.
 *
 * The gate FAILS CLOSED: CLERK_SECRET_KEY unset -> 500, missing/invalid token -> 401.
 * (The old x-reel-secret shared secret was removed — it shipped in the public JS
 * bundle via VITE_REEL_FN_SECRET, so it gated nothing.)
 *
 * Apify stays CLIENT-side (reuses the browser keyRotator + 10 keys); this function does
 * Gemini ONLY and needs just GEMINI_API_KEY. The client passes the STABLE api.apify.com
 * `downloadedVideo` URL (public, CORS-*, retained), so there is no short-TTL race here.
 *
 * Structured as a thin handler over a pure analyzeReelVideo() core so the logic
 * unit-tests with a mocked global fetch (no vercel dev needed).
 */

// Self-contained: NO runtime imports from ../src (the function is ESM; cross-boundary
// src specifiers don't resolve at runtime). .js extensions are required by Node ESM.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { buildDeepReelPrompt, DEEP_REEL_SCHEMA, HOOK_ARCHETYPES, type DeepReelAnalysis } from './_lib/deepReelPrompt.js'
import { analyzeVideoWithGemini, GeminiFilesError } from './_lib/geminiFiles.js'
import { requireClerkUser } from './_lib/auth.js'

// Node serverless (the default for @vercel/node) — we fetch binary video + drive the
// Files API. One reel is well under the 120s budget.
export const config = { maxDuration: 120 }

// Phase-1 SSRF allowlist: the client only ever sends the stable Apify-hosted URL.
const ALLOWED_HOSTS = new Set(['api.apify.com'])
const MAX_VIDEO_BYTES = 50 * 1024 * 1024 // 50MB ceiling — reels are a few MB; guard against abuse

export interface AnalyzeReelInput {
  downloadedVideoUrl: string
  shortCode: string
  caption?: string
}

export class HandlerError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Pure core: validate the URL host, fetch the video, run Gemini multimodal,
 * coerce to a DeepReelAnalysis. No transport/gate concerns — those live in the
 * handler. Throws HandlerError / GeminiFilesError with an HTTP-ish status.
 */
export async function analyzeReelVideo(input: AnalyzeReelInput, geminiApiKey: string): Promise<DeepReelAnalysis> {
  const { downloadedVideoUrl, caption } = input

  // SSRF guard: only fetch hosts we expect (the Apify key-value store).
  let host: string
  try {
    host = new URL(downloadedVideoUrl).host
  } catch {
    throw new HandlerError('Invalid downloadedVideoUrl', 400)
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw new HandlerError(`Host not allowed: ${host}`, 400)
  }

  // Fetch the video bytes server-side (no CORS, no key needed — the URL is public).
  // redirect:'manual' prevents following a redirect to a non-allowlisted host (SSRF).
  const res = await fetch(downloadedVideoUrl, { redirect: 'manual' })
  if (!res.ok) throw new HandlerError(`Video fetch failed (${res.status})`, 502)
  const contentType = (res.headers.get('content-type') || '').split(';')[0] || 'video/mp4'
  if (!/^(video\/|application\/octet-stream)/i.test(contentType)) {
    throw new HandlerError(`Unexpected content-type: ${contentType}`, 422)
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw new HandlerError('Empty video body', 502)
  if (buf.byteLength > MAX_VIDEO_BYTES) throw new HandlerError('Video too large', 413)

  // Gemini multimodal.
  const { data } = await analyzeVideoWithGemini({
    bytes: buf,
    mimeType: contentType.startsWith('video/') ? contentType : 'video/mp4',
    apiKey: geminiApiKey,
    prompt: buildDeepReelPrompt(caption ?? ''),
    schema: DEEP_REEL_SCHEMA,
  })

  return coerceDeepAnalysis(data)
}

/**
 * Guard the LLM output so a malformed/mistyped field can't crash a caller.
 * Mirrors the synthesizeNiche coercion pattern; enforces the hook enum (prior
 * learning) and clamps hookScore to 1-10.
 */
export function coerceDeepAnalysis(raw: unknown): DeepReelAnalysis {
  const o = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
  const archetype = HOOK_ARCHETYPES.includes(str(o.hookArchetype) as (typeof HOOK_ARCHETYPES)[number])
    ? str(o.hookArchetype)
    : str(o.hookArchetype) || 'Curiosity gap'
  const secondary =
    typeof o.secondaryArchetype === 'string' &&
    HOOK_ARCHETYPES.includes(o.secondaryArchetype as (typeof HOOK_ARCHETYPES)[number])
      ? o.secondaryArchetype
      : undefined
  const scoreNum = Number(o.hookScore)
  const hookScore = Number.isFinite(scoreNum) ? Math.min(10, Math.max(1, Math.round(scoreNum))) : 5

  return {
    hookArchetype: archetype,
    secondaryArchetype: secondary,
    spokenHookVerbatim: str(o.spokenHookVerbatim),
    onScreenTextHook: str(o.onScreenTextHook),
    visualOpening: str(o.visualOpening),
    hookBreakdown: str(o.hookBreakdown),
    pacingEditing: str(o.pacingEditing),
    audioStrategy: str(o.audioStrategy),
    retentionMechanism: str(o.retentionMechanism),
    psychologyTrigger: str(o.psychologyTrigger),
    ctaType: str(o.ctaType, 'none'),
    ctaPlacement: str(o.ctaPlacement, 'none'),
    replicationTemplate: str(o.replicationTemplate),
    whatToReplicate: str(o.whatToReplicate),
    whatToAvoid: str(o.whatToAvoid),
    hookScore,
  }
}

/** Parse the request body whether Vercel pre-parsed JSON (object) or left it a string. */
function parseBody(raw: unknown): Partial<AnalyzeReelInput> {
  if (raw && typeof raw === 'object') return raw as Partial<AnalyzeReelInput>
  if (typeof raw === 'string' && raw.length > 0) return JSON.parse(raw) as Partial<AnalyzeReelInput>
  return {}
}

/**
 * Vercel Node handler (req, res) — gate (method + Clerk session JWT), parse, delegate to
 * the core, map errors to clean statuses. Never echoes the Gemini key or raw upstream
 * bodies. The auth gate fails closed: no CLERK_SECRET_KEY -> 500; bad token -> 401.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Gate: verify the Clerk session JWT before doing ANY expensive work.
  const user = await requireClerkUser(req, res)
  if (!user) return

  const geminiApiKey = process.env.GEMINI_API_KEY
  if (!geminiApiKey) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  let input: AnalyzeReelInput
  try {
    const body = parseBody(req.body)
    if (!body.downloadedVideoUrl || !body.shortCode) {
      res.status(400).json({ error: 'downloadedVideoUrl and shortCode are required' })
      return
    }
    input = { downloadedVideoUrl: body.downloadedVideoUrl, shortCode: body.shortCode, caption: body.caption }
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  try {
    const analysis = await analyzeReelVideo(input, geminiApiKey)
    res.status(200).json({ shortCode: input.shortCode, analysis })
  } catch (err) {
    const status = err instanceof HandlerError || err instanceof GeminiFilesError ? err.status : 500
    // Map to a stable, non-leaky message for the client (which marks the reel failed/skipped).
    const message = err instanceof HandlerError || err instanceof GeminiFilesError ? err.message : 'Analysis failed'
    res.status(status).json({ error: message })
  }
}
