/**
 * POST /api/warm-voice-profile — Vercel serverless (Node). SECRET-gated background warmer.
 *
 * Triggered by a scheduled GitHub Action (Authorization: Bearer $CRON_SECRET). Builds voice
 * profiles for a few directory creators that don't have one yet — scrape reels (Apify) →
 * transcribe (reused getTranscript) → synthesize (Gemini) → upsert corpus_voice_profiles
 * (service-role). Backoff-aware so a bad handle doesn't retry forever. Team-shared cache →
 * each creator built once, ever. Never logs research-target data (C3): the response is
 * counts only — no handles.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getTranscript } from './get-transcript.js'
import { getApifyKeys, apifyRunSync, type KeyRing } from './_lib/apifyRun.js'
import { pickGeminiKey, geminiGenerateJson } from './_lib/geminiJson.js'
import {
  buildVoiceProfilePrompt, VOICE_PROFILE_SCHEMA, parseVoiceProfile, pickExemplars,
} from './_lib/voiceProfilePrompt.js'
import { pickHandlesToWarm, type DirectoryRow } from './_lib/warmSelector.js'

export const config = { maxDuration: 300 }

const MAX_HANDLES_PER_RUN = 2
const REEL_LIMIT = 8
// Mirror the client build (src/lib/reelScraper.ts): scrape a wide window of recent posts, then
// filter to reels client-side. Filtering by shortCode alone would keep photos/carousels (which
// have no downloadable video) and falsely fail mixed-content creators.
const POST_SCRAPE_LIMIT = 120
// Bound in-flight transcriptions so a handle with several slow (Files-API) reels can't serialize
// past the 300s function budget. Mirrors the client's transcribeLimiter (pLimit(3)).
const TRANSCRIBE_CONCURRENCY = 3

interface ReelListItem {
  shortCode?: string
  url?: string
  caption?: string | null
  productType?: string
  videoViewCount?: number
  playCount?: number
  viewCount?: number
}
interface ReelVideoItem { shortCode?: string; downloadedVideo?: string }

const reelViews = (p: ReelListItem): number => p.videoViewCount ?? p.playCount ?? p.viewCount ?? 0

/** Build + upsert ONE creator's voice profile. Throws on any failure (caller records backoff). */
async function warmHandle(supabase: SupabaseClient, entry: DirectoryRow, geminiKey: string, ring: KeyRing): Promise<void> {
  const handle = entry.handle.replace(/^@/, '')

  // 1. Reel list — wide scrape, then filter to reels only (productType 'clips'), top-N by views.
  const posts = await apifyRunSync<ReelListItem>('apify~instagram-scraper', {
    directUrls: [`https://www.instagram.com/${handle}/`], resultsType: 'posts', resultsLimit: POST_SCRAPE_LIMIT,
  }, ring)
  const reels = posts
    .filter((p) => p.productType === 'clips' && p.shortCode)
    .sort((a, b) => reelViews(b) - reelViews(a))
    .slice(0, REEL_LIMIT)
  if (reels.length === 0) throw new Error('no reels')
  const reelUrls = reels.map((r) => r.url ?? `https://www.instagram.com/reel/${r.shortCode}/`)
  const captions = reels.map((r) => r.caption ?? '').filter((c): c is string => !!c)

  // 2. Resolve downloadable video URLs.
  const videos = await apifyRunSync<ReelVideoItem>('apify~instagram-reel-scraper', {
    username: reelUrls, includeDownloadedVideo: true,
  }, ring)
  const videoByCode = new Map<string, string>()
  for (const v of videos) if (v.shortCode && v.downloadedVideo) videoByCode.set(v.shortCode, v.downloadedVideo)

  // 3. Transcribe, capped-parallel (batches of TRANSCRIBE_CONCURRENCY).
  const targets = reels
    .map((r) => ({ shortCode: r.shortCode as string, vurl: r.shortCode ? videoByCode.get(r.shortCode) : undefined }))
    .filter((t): t is { shortCode: string; vurl: string } => !!t.vurl && !!t.shortCode)
  const transcripts: string[] = []
  for (let i = 0; i < targets.length; i += TRANSCRIBE_CONCURRENCY) {
    const batch = targets.slice(i, i + TRANSCRIBE_CONCURRENCY)
    const done = await Promise.all(batch.map(async (t) => {
      try {
        const { transcript } = await getTranscript({ downloadedVideoUrl: t.vurl, shortCode: t.shortCode }, geminiKey)
        return transcript && transcript.trim() ? transcript : null
      } catch { return null }
    }))
    for (const tr of done) if (tr) transcripts.push(tr)
  }
  if (transcripts.length === 0) throw new Error('no transcripts')

  // 4. Synthesize the voice profile.
  const raw = await geminiGenerateJson(buildVoiceProfilePrompt(handle, transcripts, captions), VOICE_PROFILE_SCHEMA, geminiKey)
  const profile = parseVoiceProfile(raw, {
    handle, displayName: entry.display_name, reelCount: reels.length,
    builtAt: Date.now(), fromScripts: false, exemplars: pickExemplars(transcripts),
  })

  // 5. Upsert (team-shared, handle-keyed).
  const { error } = await supabase.from('corpus_voice_profiles').upsert({
    handle, owner_user_id: 'system:warmer', display_name: profile.displayName,
    voice_data: profile, reel_count: profile.reelCount, updated_at: new Date().toISOString(),
  }, { onConflict: 'handle' })
  if (error) throw new Error(error.message)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: 'Unauthorized' }); return }

  const apifyKeys = getApifyKeys()
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!apifyKeys.length || !pickGeminiKey() || !supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Server misconfigured (APIFY/GEMINI/SUPABASE env)' }); return
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const [dirRes, profRes] = await Promise.all([
    supabase.from('creator_directory').select('id, handle, display_name, warm_attempts, warm_last_attempt_at'),
    supabase.from('corpus_voice_profiles').select('handle'),
  ])
  if (dirRes.error || profRes.error) {
    console.error('[warmer] directory read failed:', dirRes.error ?? profRes.error)
    res.status(500).json({ error: 'Directory read failed' }); return
  }
  const existing = new Set(((profRes.data ?? []) as { handle: string }[]).map((p) => p.handle))
  const rows = (dirRes.data ?? []) as DirectoryRow[]
  const toWarm = pickHandlesToWarm(rows, existing, Date.now(), MAX_HANDLES_PER_RUN)

  const ring: KeyRing = { keys: apifyKeys, i: 0 }
  let warmedCount = 0
  let failedCount = 0
  for (const entry of toWarm) {
    const nowIso = new Date().toISOString()
    // Pre-flight backoff: mark the attempt (increment + timestamp) BEFORE the work so that if this
    // invocation is killed mid-flight (>300s), the handle is still backed off and can't be
    // re-selected first every run, starving the rest of the queue. Reset on success below.
    const geminiKey = pickGeminiKey() // fresh per handle so one throttled key can't fail both
    try {
      await supabase.from('creator_directory')
        .update({ warm_attempts: entry.warm_attempts + 1, warm_last_attempt_at: nowIso })
        .eq('id', entry.id)
      await warmHandle(supabase, entry, geminiKey, ring)
      warmedCount++
      await supabase.from('creator_directory')
        .update({ warm_attempts: 0, warm_last_error: null })
        .eq('id', entry.id)
    } catch (err) {
      failedCount++
      const msg = err instanceof Error ? err.message : String(err)
      await supabase.from('creator_directory').update({ warm_last_error: msg.slice(0, 200) }).eq('id', entry.id)
    }
  }

  // Counts only — never emit handles (they land in the GitHub Action's CI log; C3).
  res.status(200).json({
    warmedCount, failedCount,
    eligible: toWarm.length, directory: rows.length, profiled: existing.size,
    skipped: Math.max(0, rows.length - existing.size - toWarm.length),
  })
}
