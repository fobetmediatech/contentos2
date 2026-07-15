/**
 * POST /api/warm-voice-profile — Vercel serverless (Node). SECRET-gated background warmer.
 *
 * Triggered by a scheduled GitHub Action (Authorization: Bearer $CRON_SECRET). Builds voice
 * profiles for a few directory creators that don't have one yet — scrape reels (Apify) →
 * transcribe (reused getTranscript) → synthesize (Gemini) → upsert corpus_voice_profiles
 * (service-role). Backoff-aware so a bad handle doesn't retry forever. Team-shared cache →
 * each creator built once, ever. Never logs research-target data (C3): counts/handles only.
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

interface ReelListItem { shortCode?: string; url?: string; caption?: string | null }
interface ReelVideoItem { shortCode?: string; downloadedVideo?: string }

/** Build + upsert ONE creator's voice profile. Throws on any failure (caller records backoff). */
async function warmHandle(supabase: SupabaseClient, entry: DirectoryRow, geminiKey: string, ring: KeyRing): Promise<void> {
  const handle = entry.handle.replace(/^@/, '')

  const posts = await apifyRunSync<ReelListItem>('apify~instagram-scraper', {
    directUrls: [`https://www.instagram.com/${handle}/`], resultsType: 'posts', resultsLimit: REEL_LIMIT,
  }, ring)
  const reels = posts.filter((p) => p.shortCode).slice(0, REEL_LIMIT)
  if (reels.length === 0) throw new Error('no reels')
  const reelUrls = reels.map((r) => r.url ?? `https://www.instagram.com/reel/${r.shortCode}/`)
  const captions = reels.map((r) => r.caption ?? '').filter((c): c is string => !!c)

  const videos = await apifyRunSync<ReelVideoItem>('apify~instagram-reel-scraper', {
    username: reelUrls, includeDownloadedVideo: true,
  }, ring)
  const videoByCode = new Map<string, string>()
  for (const v of videos) if (v.shortCode && v.downloadedVideo) videoByCode.set(v.shortCode, v.downloadedVideo)

  const transcripts: string[] = []
  for (const r of reels) {
    const vurl = r.shortCode ? videoByCode.get(r.shortCode) : undefined
    if (!vurl || !r.shortCode) continue
    try {
      const { transcript } = await getTranscript({ downloadedVideoUrl: vurl, shortCode: r.shortCode }, geminiKey)
      if (transcript && transcript.trim()) transcripts.push(transcript)
    } catch { /* skip this reel */ }
  }
  if (transcripts.length === 0) throw new Error('no transcripts')

  const raw = await geminiGenerateJson(buildVoiceProfilePrompt(handle, transcripts, captions), VOICE_PROFILE_SCHEMA, geminiKey)
  const profile = parseVoiceProfile(raw, {
    handle, displayName: entry.display_name, reelCount: transcripts.length,
    builtAt: Date.now(), fromScripts: false, exemplars: pickExemplars(transcripts),
  })

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
  const geminiKey = pickGeminiKey()
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!apifyKeys.length || !geminiKey || !supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Server misconfigured (APIFY/GEMINI/SUPABASE env)' }); return
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const [dirRes, profRes] = await Promise.all([
    supabase.from('creator_directory').select('id, handle, display_name, warm_attempts, warm_last_attempt_at'),
    supabase.from('corpus_voice_profiles').select('handle'),
  ])
  if (dirRes.error || profRes.error) {
    res.status(500).json({ error: (dirRes.error ?? profRes.error)?.message ?? 'read failed' }); return
  }
  const existing = new Set(((profRes.data ?? []) as { handle: string }[]).map((p) => p.handle))
  const rows = (dirRes.data ?? []) as DirectoryRow[]
  const toWarm = pickHandlesToWarm(rows, existing, Date.now(), MAX_HANDLES_PER_RUN)

  const ring: KeyRing = { keys: apifyKeys, i: 0 }
  const warmed: string[] = []
  const failed: string[] = []
  for (const entry of toWarm) {
    const nowIso = new Date().toISOString()
    try {
      await warmHandle(supabase, entry, geminiKey, ring)
      warmed.push(entry.handle)
      await supabase.from('creator_directory').update({ warm_last_attempt_at: nowIso, warm_last_error: null }).eq('id', entry.id)
    } catch (err) {
      failed.push(entry.handle)
      const msg = err instanceof Error ? err.message : String(err)
      await supabase.from('creator_directory')
        .update({ warm_attempts: entry.warm_attempts + 1, warm_last_attempt_at: nowIso, warm_last_error: msg.slice(0, 200) })
        .eq('id', entry.id)
    }
  }

  res.status(200).json({ warmed, failed, eligible: toWarm.length, directory: rows.length, profiled: existing.size })
}
