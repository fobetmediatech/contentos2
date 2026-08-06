/**
 * POST /api/extract-brief — admin-only. One extraction run per client, triggered manually.
 *
 * COST GUARD: this endpoint writes cb_extractions and NOTHING ELSE. It never starts the 4-stage
 * generation pipeline. Extraction fills the form; a human presses Generate. At ~50 clients/month an
 * accidental cascade of deep reel analysis is a real credit bill, so there is deliberately no code
 * path from here into useContentStrategy.
 *
 * Flow:
 *   1. Clerk JWT -> is_admin() gate (before any model call — extraction costs money).
 *   2. Load the client's transcript chunks (onboarding calls preferred).
 *   3. Gemini structured JSON against a fixed schema.
 *   4. VERIFY every citation before storing (see below).
 *   5. Upsert one row per field.
 *
 * CITATION VERIFICATION — the part that makes provenance mean something:
 * A model asked for a verbatim quote will sometimes produce a near-quote, or cite a chunk id it
 * never saw. Both are invisible downstream: the review UI shows a citation, a human clicks it, and
 * the quote does not quite match what was said. So every citation is checked here —
 *   (a) the chunk_id must be one we actually sent, and
 *   (b) the quote must appear verbatim in that chunk (whitespace-insensitive).
 * Failing citations are DROPPED. If that leaves an 'extracted' field with none, its value is forced
 * to null rather than stored uncited — the same rule the database enforces, applied early so the
 * caller gets a clear count instead of a constraint violation.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './auth.js'
import { geminiGenerateJson, pickGeminiKey, GeminiJsonError } from './geminiJson.js'
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTABLE_FIELDS,
  buildExtractionPayload,
} from './extractionPrompt.js'
import { verifyExtraction } from './verifyExtraction.js'
import { decodeDocs, uploadDocs, ContextDocError } from './contextDocs.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

/** Stamped onto every row so a prompt change is traceable in the data. */
const MODEL_VERSION = 'extract-brief@1'

const bearer = (req: VercelRequest): string => {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

const headers = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({
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
    headers: headers(token, init.prefer ? { Prefer: init.prefer } : {}),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* 204 */ }
  return { ok: res.ok, status: res.status, json }
}

/** Shape the model returns; validated by verifyExtraction before anything is stored. */
interface ModelField {
  field_name?: unknown
  value?: unknown
  provenance?: unknown
  confidence?: unknown
  citations?: unknown
}

export async function handleExtract(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await requireClerkUser(req, res)
  if (!user) return
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const token = bearer(req)

  // Admin gate BEFORE the model call — extraction costs money, so a non-admin must not spend it.
  const adminCheck = await rest('rpc/is_admin', token, { method: 'POST', body: {} })
  if (adminCheck.json !== true) {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  const body = req.body as { clientId?: unknown; documents?: unknown } | undefined
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId) {
    res.status(400).json({ error: 'clientId required' })
    return
  }

  // ---- load the client's chunks ------------------------------------------------------------
  // Onboarding calls carry the brief material; if none has been ingested, fall back to whatever
  // transcripts this client has rather than returning nothing.
  const transcriptsRes = await rest(
    `cb_transcripts?select=id,meeting_type&client_id=eq.${clientId}&join_status=eq.matched`,
    token,
    { method: 'GET' },
  )
  const transcripts = Array.isArray(transcriptsRes.json)
    ? (transcriptsRes.json as Array<{ id: string; meeting_type: string }>)
    : []
  if (transcripts.length === 0) {
    res.status(404).json({ error: 'no_matched_transcripts' })
    return
  }

  const onboarding = transcripts.filter((t) => t.meeting_type === 'onboarding')
  const use = onboarding.length > 0 ? onboarding : transcripts
  const idList = use.map((t) => `"${t.id}"`).join(',')

  const chunksRes = await rest(
    `cb_transcript_chunks?select=id,text,speaker,start_sec&transcript_id=in.(${encodeURIComponent(idList)})&order=transcript_id,chunk_index`,
    token,
    { method: 'GET' },
  )
  const chunks = Array.isArray(chunksRes.json)
    ? (chunksRes.json as Array<{ id: string; text: string; speaker: string | null; start_sec: number | null }>)
    : []
  if (chunks.length === 0) {
    res.status(404).json({ error: 'no_chunks' })
    return
  }

  // ---- extract -------------------------------------------------------------------------------
  const payload = buildExtractionPayload(
    chunks.map((c) => ({ id: c.id, text: c.text, speaker: c.speaker, startSec: c.start_sec })),
  )

  // Context documents go straight to Gemini — never parsed here. They are ADDITIONAL evidence,
  // not a replacement for the call: a value sourced from a document still needs a citation, and
  // the prompt's cardinal rule (say null if it was not said) is unchanged.
  const geminiKey = pickGeminiKey()
  let docs: { count: number; parts: unknown[] }
  try {
    const decoded = decodeDocs(body?.documents)
    docs = { count: decoded.length, parts: decoded.length > 0 ? await uploadDocs(decoded, geminiKey) : [] }
  } catch (err) {
    const status = err instanceof ContextDocError ? err.status : 400
    res.status(status).json({ error: 'document_failed', detail: err instanceof Error ? err.message : 'bad document' })
    return
  }

  let parsed: { fields?: ModelField[] }
  try {
    parsed = (await geminiGenerateJson(
      `${EXTRACTION_SYSTEM_PROMPT}\n\n${payload}`,
      EXTRACTION_SCHEMA,
      geminiKey,
      docs.parts,
    )) as { fields?: ModelField[] }
  } catch (err) {
    const status = err instanceof GeminiJsonError ? 502 : 500
    res.status(status).json({ error: 'extraction_failed' })
    return
  }

  // ---- verify citations ----------------------------------------------------------------------
  // Pure + unit-tested (verifyExtraction.test.ts). Drops unverifiable citations and nulls any
  // 'extracted' value left with nothing behind it.
  const verified = verifyExtraction(parsed.fields, chunks, EXTRACTABLE_FIELDS)
  const { droppedCitations, forcedNull, rejectedFields } = verified

  const rows = verified.fields.map((f) => ({
    client_id: clientId,
    field_name: f.field_name,
    value: f.value,
    citations: f.citations,
    provenance: f.provenance,
    confidence: f.confidence,
    review_status: 'pending',
    model_version: MODEL_VERSION,
    updated_at: new Date().toISOString(),
  }))

  if (rows.length === 0) {
    res.status(502).json({ error: 'no_fields_returned' })
    return
  }

  const write = await rest('cb_extractions?on_conflict=client_id,field_name', token, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: rows,
  })
  if (!write.ok) {
    res.status(502).json({ error: 'extraction_write_failed', detail: write.status })
    return
  }

  res.status(200).json({
    ok: true,
    clientId,
    chunksRead: chunks.length,
    documentsRead: docs.count,
    fieldsWritten: rows.length,
    filled: rows.filter((r) => r.value !== null).length,
    empty: rows.filter((r) => r.value === null).length,
    inferred: rows.filter((r) => r.provenance === 'inferred' && r.value !== null).length,
    droppedCitations,
    forcedNull,
    // Non-zero means the model tried to write a field it must not — a handle, or something outside
    // the brief. Worth watching: a rising count is a prompt regression, not a data problem.
    rejectedFields,
    // Handles are never extracted — they come from the sales sheet.
    note: 'competitors/aspirational are sheet-sourced and were not extracted. Generation is NOT triggered.',
  })
}
