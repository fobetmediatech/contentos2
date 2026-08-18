/**
 * Review data access — cb_clients + cb_extractions + cb_transcripts.
 *
 * RLS on these tables is open to any signed-in member (20260810000000), so an empty result means
 * there is genuinely nothing there rather than a permission problem.
 */
import { supabase } from './supabaseClient'
import type { Citation, ExtractionRow, Provenance, ReviewStatus } from './reviewGate'

export interface ReviewClient {
  id: string
  displayName: string
  emails: string[]
  createdAt: number
}

function toRow(r: Record<string, unknown>): ExtractionRow {
  const rawCitations = Array.isArray(r.citations) ? (r.citations as unknown[]) : []
  return {
    id: r.id as string,
    fieldName: (r.field_name as string) ?? '',
    value: (r.value as string | null) ?? null,
    citations: rawCitations
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
      .map(
        (c): Citation => ({
          chunk_id: String(c.chunk_id ?? ''),
          quote: String(c.quote ?? ''),
          start_sec: typeof c.start_sec === 'number' ? c.start_sec : null,
        }),
      ),
    provenance: ((r.provenance as string) ?? 'extracted') as Provenance,
    confidence: typeof r.confidence === 'number' ? r.confidence : null,
    reviewStatus: ((r.review_status as string) ?? 'pending') as ReviewStatus,
    originalValue: (r.original_value as string | null) ?? null,
  }
}

export async function listClients(): Promise<ReviewClient[]> {
  const { data, error } = await supabase
    .from('cb_clients')
    .select('id,display_name,created_at,cb_client_emails(email)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    displayName: (r.display_name as string) ?? '',
    emails: Array.isArray(r.cb_client_emails)
      ? (r.cb_client_emails as Array<{ email: string }>).map((e) => e.email)
      : [],
    createdAt: r.created_at ? new Date(r.created_at as string).getTime() : 0,
  }))
}

export async function listExtractions(clientId: string): Promise<ExtractionRow[]> {
  const { data, error } = await supabase
    .from('cb_extractions')
    .select('id,field_name,value,citations,provenance,confidence,review_status,original_value')
    .eq('client_id', clientId)
  if (error) throw error
  return (data ?? []).map(toRow)
}

/**
 * Persist a reviewer's decision. `original_value` is written only on the FIRST edit, so the
 * comparison always points at what the model produced rather than the previous edit.
 */
export async function saveRow(
  row: ExtractionRow,
  patch: { value?: string | null; reviewStatus?: ReviewStatus },
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (patch.value !== undefined) {
    update.value = patch.value?.trim() ? patch.value.trim() : null
    if (row.originalValue === null && row.value !== null) update.original_value = row.value
    update.review_status = 'edited'
  }
  if (patch.reviewStatus !== undefined) update.review_status = patch.reviewStatus

  const { error } = await supabase.from('cb_extractions').update(update).eq('id', row.id)
  if (error) throw error
}

/** Bulk approve. Used by "approve all" — one round trip rather than one per field. */
export async function approveRows(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('cb_extractions')
    .update({ review_status: 'approved', updated_at: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
}

/** Transcript context for a citation: which meeting, and where in it. */
export async function transcriptForChunk(
  chunkId: string,
): Promise<{ title: string | null; speaker: string | null } | null> {
  const { data, error } = await supabase
    .from('cb_transcript_chunks')
    .select('speaker,cb_transcripts(title)')
    .eq('id', chunkId)
    .maybeSingle()
  if (error || !data) return null
  const t = (data as Record<string, unknown>).cb_transcripts as { title?: string } | null
  return { title: t?.title ?? null, speaker: ((data as Record<string, unknown>).speaker as string) ?? null }
}

/**
 * Create a row for a field extraction never produced — a handle, or any value a human types into
 * an empty field. Without this, typing into such a field silently does nothing: there is no row to
 * update, so the value never leaves component state and the export gate never sees it.
 *
 * provenance 'sheet' because it is the only value legal for handle fields (the DB forbids
 * model-authored handles) and, unlike 'extracted', it carries no citation requirement — correct
 * here, since a human typing a value has no transcript quote behind it.
 */
export async function createRow(
  clientId: string,
  fieldName: string,
  value: string,
): Promise<void> {
  const { error } = await supabase.from('cb_extractions').upsert(
    {
      client_id: clientId,
      field_name: fieldName,
      value: value.trim() || null,
      citations: [],
      provenance: 'sheet',
      review_status: 'edited',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,field_name' },
  )
  if (error) throw error
}

export interface IngestedTranscript {
  id: string
  title: string | null
  meetingDate: number | null
  meetingType: string
  clientId: string | null
}

/**
 * Ingested calls, newest first — the source for the /ask meeting picker.
 *
 * Reads cb_transcripts, NOT the Fireflies API. Fireflies is rate-limited per day and /strategy
 * already spends a request per visit with no caching; a picker that called it would multiply that
 * by every question asked. Reading the table also makes this list an honest answer to "is this call
 * in the bot yet?".
 */
export async function listIngestedTranscripts(): Promise<IngestedTranscript[]> {
  const { data, error } = await supabase
    .from('cb_transcripts')
    .select('id,title,meeting_date,meeting_type,client_id')
    .order('meeting_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    title: (r.title as string | null) ?? null,
    meetingDate: r.meeting_date ? new Date(r.meeting_date as string).getTime() : null,
    meetingType: (r.meeting_type as string) ?? 'sales',
    clientId: (r.client_id as string | null) ?? null,
  }))
}
