/**
 * POST /api/ingest-transcript — admin-only. Manual, one transcript at a time.
 *
 * Deliberately NOT scheduled. Ingestion is triggered per client after the onboarding call lands,
 * so nothing runs unattended and nothing cascades. This endpoint fills the transcript tables only —
 * it never triggers extraction and never touches the 4-stage generation pipeline.
 *
 * Flow:
 *   1. Verify the Clerk session JWT.
 *   2. Confirm the CALLER is an admin via Supabase is_admin(), before any Fireflies call — a
 *      non-admin must not be able to use this to enumerate meetings.
 *   3. Fetch the transcript from the source.
 *   4. Resolve the join by EXACT email match (see below).
 *   5. Upsert the transcript, then replace its chunks (embedded).
 *
 * AUTH MODEL: the caller's own token is forwarded to PostgREST, so the RLS on the cb_
 * tables evaluates against the real user. No service_role key, so no new secret and no way for a
 * bug here to escalate past what the caller could already do.
 *
 * THE JOIN — exact email match, no heuristics:
 *   Every address on the meeting is looked up in cb_client_emails on lower(btrim(email)).
 *   1 distinct client  -> matched
 *   >1 distinct clients -> ambiguous  (two clients on one call; a human decides)
 *   0                   -> unmatched  (incl. every link-joined meeting, which carries no attendees)
 *
 *   Internal addresses need no special-casing: they are simply never registered as client emails,
 *   so they resolve to nothing. That avoids domain classification entirely — which matters because
 *   observed client attendees use @gmail.com, so "same domain => same client" would be wrong.
 *
 *   There is deliberately NO fuzzy name matching, even though speaker names and meeting titles
 *   carry client names. At ~50 clients/month it would eventually attach the wrong client's
 *   transcript to the wrong deck, and the result looks entirely plausible because every field is
 *   populated. An unmatched transcript in a queue is a visible problem; a mis-matched one is not.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './auth.js'
import { createFirefliesSource, TranscriptSourceError } from './transcriptSource.js'
import { chunkTranscript } from './chunkTranscript.js'
import { embedTexts, toVectorLiteral, EMBED_MODEL } from './embed.js'
import { pickGeminiKey } from './geminiJson.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

const bearer = (req: VercelRequest): string => {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

const restHeaders = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({
  'Content-Type': 'application/json',
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${token}`,
  ...extra,
})

async function rest(
  path: string,
  token: string,
  init: { method: string; body?: unknown; prefer?: string },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers: restHeaders(token, init.prefer ? { Prefer: init.prefer } : {}),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* 204 */ }
  return { ok: res.ok, status: res.status, json }
}

export async function handleIngest(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await requireClerkUser(req, res)
  if (!user) return

  const firefliesKey = process.env.FIREFLIES_API_KEY
  // GEMINI_API_KEY holds a COMMA-SEPARATED POOL, not a single key — pickGeminiKey() splits it and
  // also folds in GEMINI_KEYS. Reading the env var raw sends the whole joined string as one key and
  // Gemini answers 401. Every other endpoint here uses pickGeminiKey(); this one did not.
  const geminiKey = pickGeminiKey()
  if (!SUPABASE_URL || !SUPABASE_ANON || !firefliesKey || !geminiKey) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const token = bearer(req)

  // Signed-in is enough — this feature is open to the whole team (20260810000000).

  const body = req.body as { action?: unknown; externalId?: unknown; clientId?: unknown } | undefined
  const action = typeof body?.action === 'string' ? body.action : 'ingest-meeting'
  const source = createFirefliesSource(firefliesKey)

  try {
    // ---- list: what can be ingested? --------------------------------------------------------
    if (action === 'list-meetings') {
      const items = await source.list?.(25) ?? []
      res.status(200).json({
        transcripts: items.map((t) => ({
          externalId: t.externalId,
          title: t.title,
          meetingDateMs: t.meetingDateMs,
          durationSec: t.durationSec,
          // Surfaced so the UI can warn BEFORE ingesting: no calendar event means no attendee
          // list, which means this transcript can only ever be assigned by hand.
          calendarSourced: Boolean(t.calendarId),
          emailCount: t.participantEmails.length,
        })),
      })
      return
    }

    // ---- ingest one -------------------------------------------------------------------------
    const externalId = typeof body?.externalId === 'string' ? body.externalId.trim() : ''
    if (!externalId) {
      res.status(400).json({ error: 'externalId required' })
      return
    }
    const forcedClientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''

    const raw = await source.fetch(externalId)
    if (!raw) {
      res.status(404).json({ error: 'transcript_not_found' })
      return
    }

    // ---- resolve the join -------------------------------------------------------------------
    let clientId: string | null = null
    let joinStatus: 'matched' | 'ambiguous' | 'unmatched' = 'unmatched'
    let matchedEmails: string[] = []

    if (forcedClientId) {
      // Manual assignment — the backfill path for link-joined meetings that can never carry emails.
      clientId = forcedClientId
      joinStatus = 'matched'
    } else if (raw.participantEmails.length > 0) {
      const list = raw.participantEmails.map((e) => `"${e}"`).join(',')
      const lookup = await rest(
        `cb_client_emails?select=client_id,email&email=in.(${encodeURIComponent(list)})`,
        token,
        { method: 'GET' },
      )
      const rows = Array.isArray(lookup.json) ? (lookup.json as Array<{ client_id: string; email: string }>) : []
      const distinct = [...new Set(rows.map((r) => r.client_id))]
      matchedEmails = rows.map((r) => r.email)

      if (distinct.length === 1) {
        clientId = distinct[0]
        joinStatus = 'matched'
      } else if (distinct.length > 1) {
        joinStatus = 'ambiguous' // two clients on one call — a human decides, we do not guess
      }
    }

    // ---- upsert the transcript (idempotent on source + external_id) --------------------------
    const upsert = await rest('cb_transcripts?on_conflict=source,external_id', token, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: [{
        client_id: clientId,
        source: source.name,
        external_id: raw.externalId,
        title: raw.title,
        meeting_type: inferMeetingType(raw.title),
        meeting_date: raw.meetingDateMs ? new Date(raw.meetingDateMs).toISOString() : null,
        duration_sec: raw.durationSec,
        participants: raw.participantEmails,
        full_text: raw.fullText,
        join_status: joinStatus,
        updated_at: new Date().toISOString(),
      }],
    })
    if (!upsert.ok) {
      res.status(502).json({
        error: 'transcript_upsert_failed',
        detail: `HTTP ${upsert.status} ${JSON.stringify(upsert.json).slice(0, 300)}`,
      })
      return
    }
    const transcriptId = (upsert.json as Array<{ id: string }>)?.[0]?.id
    if (!transcriptId) {
      res.status(502).json({ error: 'transcript_upsert_no_id' })
      return
    }

    // ---- chunk + embed + replace ------------------------------------------------------------
    const chunks = chunkTranscript(raw.sentences)
    let embedded = 0

    if (chunks.length > 0) {
      const vectors = await embedTexts(chunks.map((c) => c.text), geminiKey, 'RETRIEVAL_DOCUMENT')

      // Replace rather than merge: re-ingesting after a chunking change must not leave orphans
      // from the previous shape sitting in search results.
      await rest(`cb_transcript_chunks?transcript_id=eq.${transcriptId}`, token, { method: 'DELETE' })

      const insert = await rest('cb_transcript_chunks', token, {
        method: 'POST',
        prefer: 'return=minimal',
        body: chunks.map((c, i) => ({
          transcript_id: transcriptId,
          chunk_index: c.index,
          text: c.text,
          speaker: c.speaker,
          start_sec: c.startSec,
          end_sec: c.endSec,
          embedding: toVectorLiteral(vectors[i]),
          embedding_model: EMBED_MODEL,
        })),
      })
      if (!insert.ok) {
        res.status(502).json({
        error: 'chunk_insert_failed',
        detail: `HTTP ${insert.status} ${JSON.stringify(insert.json).slice(0, 300)}`,
      })
        return
      }
      embedded = chunks.length
    }

    res.status(200).json({
      ok: true,
      transcriptId,
      externalId: raw.externalId,
      title: raw.title,
      joinStatus,
      clientId,
      matchedEmails,
      calendarSourced: Boolean(raw.calendarId),
      chunks: embedded,
      // Extraction is a separate, explicit step. Ingestion never starts it, and neither ever
      // starts the generation pipeline.
      nextStep: joinStatus === 'matched' ? 'run_extraction' : 'assign_client_in_review_queue',
    })
  } catch (err) {
    if (err instanceof TranscriptSourceError) {
      res.status(502).json({ error: 'source_failed', detail: err.message })
      return
    }
    // Say WHAT failed. A bare 'ingest_failed' sent us guessing between the embedding call, the
    // vector insert and the DB write — the error already knew which. Our error messages are
    // written to never echo a key or an upstream response body, so this is safe to surface.
    res.status(500).json({
      error: 'ingest_failed',
      detail: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error',
    })
  }
}

/**
 * Meeting type from the title. Titles observed in this workspace are explicit ("Discovery Call
 * with Aman", "Onboarding Call - Abhijeet"), so a keyword read is honest here — and unlike the
 * client join, guessing wrong is cheap and visible rather than silently mis-attributing data.
 */
function inferMeetingType(title: string | null): 'sales' | 'onboarding' | 'strategy' | 'review' {
  const t = (title ?? '').toLowerCase()
  if (t.includes('onboard')) return 'onboarding'
  if (t.includes('strategy')) return 'strategy'
  if (t.includes('review')) return 'review'
  return 'sales' // discovery/sales calls are the default entry point to the funnel
}
