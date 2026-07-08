/**
 * Supabase data access for saved Client Strategies + their file attachments.
 *
 * Mirrors calendarRepo.ts conventions: maps snake_case rows ↔ camelCase domain types; RLS does
 * the real access control (both tables are team-shared — any signed-in member reads + writes).
 *
 * Files live in the private `client-strategy-files` storage bucket at `{strategyId}/{uuid}-{name}`;
 * this module keeps the metadata table (`client_strategy_attachments`) and the bucket in sync and
 * hands out short-lived signed URLs for download. Attachments are informational only.
 */
import { supabase } from './supabaseClient'
import type { SavedClientStrategy, StrategyAttachment, StrategyResult } from '../domain/strategy'

const BUCKET = 'client-strategy-files'

const ms = (t: string | null): number => (t ? new Date(t).getTime() : 0)

// ---------- Saved client strategies (team-shared) ----------

function rowToSaved(r: Record<string, unknown>): SavedClientStrategy {
  return {
    id: r.id as string,
    brandName: (r.brand_name as string) ?? '',
    offer: (r.offer as string | null) ?? '',
    result: r.result as StrategyResult,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: ms(r.created_at as string | null),
    updatedAt: ms(r.updated_at as string | null),
  }
}

/** All saved clients, newest first. `result` is included (jsonb) so detail views need no re-fetch. */
export async function listSavedClients(): Promise<SavedClientStrategy[]> {
  const { data, error } = await supabase
    .from('client_strategies')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToSaved)
}

export async function getSavedClient(id: string): Promise<SavedClientStrategy | null> {
  const { data, error } = await supabase.from('client_strategies').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? rowToSaved(data as Record<string, unknown>) : null
}

/** Persist a freshly generated strategy as a shared client. brand_name/offer denormalized from the brief. */
export async function saveClient(result: StrategyResult): Promise<SavedClientStrategy> {
  const { data, error } = await supabase
    .from('client_strategies')
    .insert({
      brand_name: result.brief.brandName || 'Untitled client',
      offer: result.brief.offer || null,
      result,
    })
    .select()
    .single()
  if (error) throw error
  return rowToSaved(data as Record<string, unknown>)
}

/** Deletes a client. Attachment rows cascade (FK); the storage objects are removed first. */
export async function deleteSavedClient(id: string): Promise<void> {
  const atts = await listAttachments(id)
  if (atts.length) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(atts.map((a) => a.storagePath))
    if (rmErr) throw rmErr
  }
  const { error } = await supabase.from('client_strategies').delete().eq('id', id)
  if (error) throw error
}

// ---------- Attachments (metadata table + storage bucket) ----------

function rowToAttachment(r: Record<string, unknown>): StrategyAttachment {
  return {
    id: r.id as string,
    strategyId: (r.strategy_id as string) ?? '',
    fileName: (r.file_name as string) ?? '',
    storagePath: (r.storage_path as string) ?? '',
    mimeType: (r.mime_type as string | null) ?? null,
    sizeBytes: (r.size_bytes as number | null) ?? null,
    uploadedBy: (r.uploaded_by as string | null) ?? null,
    createdAt: ms(r.created_at as string | null),
  }
}

export async function listAttachments(strategyId: string): Promise<StrategyAttachment[]> {
  const { data, error } = await supabase
    .from('client_strategy_attachments')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToAttachment)
}

/** Sanitize a filename for use inside a storage key (keep it readable, drop anything unsafe). */
function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-120) || 'file'
}

/** Upload one file to the bucket, then record its metadata row. */
export async function uploadAttachment(strategyId: string, file: File): Promise<StrategyAttachment> {
  const path = `${strategyId}/${crypto.randomUUID()}-${safeName(file.name)}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) throw upErr

  const { data, error } = await supabase
    .from('client_strategy_attachments')
    .insert({
      strategy_id: strategyId,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
    })
    .select()
    .single()
  if (error) {
    // Metadata insert failed — don't orphan the object in the bucket.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  return rowToAttachment(data as Record<string, unknown>)
}

/** Remove the storage object, then its metadata row. */
export async function deleteAttachment(att: StrategyAttachment): Promise<void> {
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([att.storagePath])
  if (rmErr) throw rmErr
  const { error } = await supabase.from('client_strategy_attachments').delete().eq('id', att.id)
  if (error) throw error
}

/** Short-lived signed URL for downloading/viewing an attachment (private bucket). */
export async function attachmentUrl(att: StrategyAttachment): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(att.storagePath, 60 * 10)
  if (error) throw error
  return data.signedUrl
}
