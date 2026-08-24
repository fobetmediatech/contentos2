/**
 * POST /api/strategy-ai { action: 'brief' } — a one-page discovery-call brief for one transcript.
 *
 * Sibling of handleSummary. One Gemini call over full_text; works on ANY ingested transcript, no
 * client match required (unlike the extraction pipeline).
 *
 * Generated once and cached on cb_transcripts.brief: the whole team opens the same meeting
 * repeatedly. `force: true` regenerates. Both cache columns are nullable — a null brief means
 * "never generated", which must stay distinguishable from a brief that genuinely found nothing.
 *
 * Reads full_text, NOT cb_transcript_chunks — the chunks overlap on purpose for retrieval quality.
 *
 * AUTH: the caller's token is forwarded to PostgREST, so RLS decides what is readable. No service key.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './auth.js'
import { geminiGenerateJson, pickGeminiKey } from './geminiJson.js'
import { buildBriefPrompt, BRIEF_SCHEMA, normaliseBrief, type DiscoveryBrief } from './briefPrompt.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

const bearer = (req: VercelRequest): string => {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

async function rest(
  path: string,
  token: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* 204 */ }
  return { ok: res.ok, json }
}

interface TranscriptRow {
  id: string
  title: string | null
  meeting_date: string | null
  full_text: string | null
  brief: unknown
  brief_generated_at: string | null
}

export async function handleBrief(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await requireClerkUser(req, res)
  if (!user) return
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const body = req.body as { transcriptId?: unknown; force?: unknown } | undefined
  const transcriptId =
    typeof body?.transcriptId === 'string' && body.transcriptId.trim() ? body.transcriptId.trim() : ''
  const force = body?.force === true
  if (!transcriptId) {
    res.status(400).json({ error: 'transcriptId required' })
    return
  }

  const token = bearer(req)

  try {
    const r = await rest(
      `cb_transcripts?select=id,title,meeting_date,full_text,brief,brief_generated_at&id=eq.${encodeURIComponent(transcriptId)}&limit=1`,
      token,
      { method: 'GET' },
    )
    // A non-2xx here (malformed uuid, backend failure) is NOT "no such transcript" — same guard as
    // handlerSummary/handlerAsk.
    if (!r.ok) {
      res.status(502).json({
        error: 'brief_retrieval_failed',
        detail: 'Could not read the transcript. This is a failure, not a missing record.',
      })
      return
    }
    const row = Array.isArray(r.json) ? (r.json as TranscriptRow[])[0] : undefined
    if (!row) {
      res.status(404).json({ error: 'transcript_not_found', detail: 'No such transcript, or it is not readable by you.' })
      return
    }

    if (!force && row.brief) {
      res.status(200).json({
        brief: normaliseBrief(row.brief),
        cached: true,
        title: row.title,
        meetingDate: row.meeting_date,
        generatedAt: row.brief_generated_at,
      })
      return
    }

    if (!row.full_text || !row.full_text.trim()) {
      res.status(422).json({
        error: 'no_transcript_text',
        detail: 'This call has no transcript text ingested, so there is nothing to brief.',
      })
      return
    }

    const parsed = await geminiGenerateJson(
      buildBriefPrompt(row.title, row.full_text),
      BRIEF_SCHEMA,
      pickGeminiKey(),
    )
    const brief: DiscoveryBrief = normaliseBrief(parsed)
    const generatedAt = new Date().toISOString()

    // A failed write is not fatal — the brief is still returned, just uncached. Losing the cache
    // costs a repeat call; failing the request costs the user their document. Same posture as
    // handlerSummary. No transcript content in the log line.
    const wrote = await rest(`cb_transcripts?id=eq.${encodeURIComponent(transcriptId)}`, token, {
      method: 'PATCH',
      body: { brief, brief_generated_at: generatedAt },
    })
    if (!wrote.ok) console.error('[brief] cache write failed for transcript', transcriptId)

    res.status(200).json({
      brief,
      cached: false,
      title: row.title,
      meetingDate: row.meeting_date,
      generatedAt,
    })
  } catch {
    res.status(502).json({
      error: 'brief_failed',
      detail: 'Could not generate the brief. The model call failed.',
    })
  }
}
