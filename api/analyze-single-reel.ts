/**
 * POST /api/analyze-single-reel — Vercel serverless (Node / Fluid Compute).
 *
 * Deep case-study analysis of ONE reel. The client scrapes the reel (Apify, client-side)
 * and posts the stable api.apify.com video URL + the reel's Apify metadata. This function:
 *   gate(Clerk JWT) → SSRF-allowlist the video host → fetch bytes →
 *   Stage 1 (Gemini Files API): transcript + timestamped segments + video mechanics →
 *   Stage 2 (Gemini text-only): a hookmap-style markdown case study →
 *   { transcript, segments, videoAnalysis, markdown }.
 *
 * Self-contained ESM (no ../src imports). Gate FAILS CLOSED. Same SSRF allowlist + size
 * cap as analyze-reel-video.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { analyzeVideoWithGemini, GeminiFilesError } from './_lib/geminiFiles.js'
import { geminiGenerateMarkdown, GeminiTextError } from './_lib/geminiText.js'
import {
  SINGLE_REEL_EXTRACTION_SCHEMA,
  buildExtractionPrompt,
  buildSynthesisPrompt,
  coerceExtraction,
  type ReelExtraction,
} from './_lib/singleReelPrompt.js'
import { requireClerkUser } from './_lib/auth.js'

export const config = { maxDuration: 180 }

const ALLOWED_HOSTS = new Set(['api.apify.com'])
const MAX_VIDEO_BYTES = 50 * 1024 * 1024

/** ONE Gemini key from the pool (see analyze-reel-video.ts:pickGeminiKey). */
export function pickGeminiKey(): string {
  const keys = [
    ...String(process.env.GEMINI_API_KEY ?? '').split(','),
    ...String(process.env.GEMINI_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
  return keys[Math.floor(Math.random() * keys.length)] ?? ''
}

export interface SingleReelApifyMeta {
  ownerUsername?: string
  caption?: string
  likesCount?: number
  commentsCount?: number
  videoViewCount?: number
  videoDuration?: number
  hashtags?: string[]
  timestamp?: string
  musicInfo?: unknown
}

export interface AnalyzeSingleReelInput {
  downloadedVideoUrl: string
  shortCode: string
  apify: SingleReelApifyMeta
}

export interface SingleReelResult extends ReelExtraction {
  markdown: string
}

export class HandlerError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function analyzeSingleReel(input: AnalyzeSingleReelInput, geminiApiKey: string): Promise<SingleReelResult> {
  const { downloadedVideoUrl, apify } = input

  let host: string
  try {
    host = new URL(downloadedVideoUrl).host
  } catch {
    throw new HandlerError('Invalid downloadedVideoUrl', 400)
  }
  if (!ALLOWED_HOSTS.has(host)) throw new HandlerError(`Host not allowed: ${host}`, 400)

  const res = await fetch(downloadedVideoUrl, { redirect: 'manual' })
  if (!res.ok) throw new HandlerError(`Video fetch failed (${res.status})`, 502)
  const contentType = (res.headers.get('content-type') || '').split(';')[0] || 'video/mp4'
  if (!/^(video\/|application\/octet-stream)/i.test(contentType)) {
    throw new HandlerError(`Unexpected content-type: ${contentType}`, 422)
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw new HandlerError('Empty video body', 502)
  if (buf.byteLength > MAX_VIDEO_BYTES) throw new HandlerError('Video too large', 413)

  // Stage 1: extraction (multimodal).
  const { data } = await analyzeVideoWithGemini({
    bytes: buf,
    mimeType: contentType.startsWith('video/') ? contentType : 'video/mp4',
    apiKey: geminiApiKey,
    prompt: buildExtractionPrompt(),
    schema: SINGLE_REEL_EXTRACTION_SCHEMA,
  })
  const extraction = coerceExtraction(data)

  // Stage 2: synthesis (text-only markdown).
  const userPayload = JSON.stringify(
    {
      reel_url: `https://www.instagram.com/reel/${input.shortCode}/`,
      handle: apify.ownerUsername ?? '',
      apify: {
        caption: apify.caption ?? '',
        likesCount: apify.likesCount ?? 0,
        commentsCount: apify.commentsCount ?? 0,
        videoViewCount: apify.videoViewCount ?? 0,
        videoDuration: apify.videoDuration ?? 0,
        hashtags: apify.hashtags ?? [],
        timestamp: apify.timestamp ?? '',
        musicInfo: apify.musicInfo ?? null,
      },
      transcript: extraction.transcript,
      transcript_segments: extraction.segments,
      video_analysis: extraction.videoAnalysis,
    },
    null,
    2,
  )
  const markdown = await geminiGenerateMarkdown({
    systemPrompt: buildSynthesisPrompt(),
    userPayload,
    apiKey: geminiApiKey,
  })

  return { ...extraction, markdown }
}

function parseBody(raw: unknown): Partial<AnalyzeSingleReelInput> {
  if (raw && typeof raw === 'object') return raw as Partial<AnalyzeSingleReelInput>
  if (typeof raw === 'string' && raw.length > 0) return JSON.parse(raw) as Partial<AnalyzeSingleReelInput>
  return {}
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const user = await requireClerkUser(req, res)
  if (!user) return

  const geminiApiKey = pickGeminiKey()
  if (!geminiApiKey) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  let input: AnalyzeSingleReelInput
  try {
    const body = parseBody(req.body)
    if (!body.downloadedVideoUrl || !body.shortCode) {
      res.status(400).json({ error: 'downloadedVideoUrl and shortCode are required' })
      return
    }
    input = { downloadedVideoUrl: body.downloadedVideoUrl, shortCode: body.shortCode, apify: body.apify ?? {} }
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  try {
    const result = await analyzeSingleReel(input, geminiApiKey)
    res.status(200).json({ shortCode: input.shortCode, result })
  } catch (err) {
    const known = err instanceof HandlerError || err instanceof GeminiFilesError || err instanceof GeminiTextError
    res.status(known ? (err as { status: number }).status : 500).json({
      error: known ? (err as Error).message : 'Analysis failed',
    })
  }
}
