/**
 * Supabase CRUD layer for the tracking dashboard.
 * Tables: tracked_accounts, account_snapshots, reel_snapshots.
 */
import { supabase } from './supabaseClient'
import { getClerkUserId } from './clerkToken'

// ---------- Types ----------

export interface TrackedAccount {
  username: string
  full_name: string | null
  profile_pic_url: string | null
  biography: string | null
  is_verified: boolean
  is_business: boolean
  added_by: string
  added_at: string
  scrape_window_days: number
  scrape_interval_days: number
  next_fetch_at: string
  last_error: string | null
  last_error_at: string | null
}

export interface AccountSnapshot {
  id: string
  username: string
  fetched_at: string
  followers_count: number
  posts_count: number
  follows_count: number
  raw_payload: Record<string, unknown>
}

export interface ReelSnapshot {
  id: string
  username: string
  fetched_at: string
  reel_url: string
  thumbnail_url: string | null
  posted_at: string | null
  views_count: number
  likes_count: number
  comments_count: number
  raw_payload: Record<string, unknown>
}

// ---------- error helpers ----------

/**
 * Best-effort human-readable message from an unknown thrown value.
 * Supabase/PostgREST errors are plain objects with a string `message` (e.g.
 * PGRST205 "Could not find the table…") but are NOT `instanceof Error`, so the
 * usual `instanceof Error` check silently drops their detail. This recovers it.
 */
export function trackingErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m
  }
  return fallback
}

// ---------- tracked_accounts ----------

export async function getTrackedAccounts(): Promise<TrackedAccount[]> {
  const { data, error } = await supabase
    .from('tracked_accounts')
    .select('*')
    .order('added_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TrackedAccount[]
}

export async function getTrackedAccount(username: string): Promise<TrackedAccount | null> {
  const { data, error } = await supabase
    .from('tracked_accounts')
    .select('*')
    .eq('username', username)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return (data as TrackedAccount | null) ?? null
}

export async function addTrackedAccount(username: string): Promise<TrackedAccount> {
  const userId = await getClerkUserId()
  if (!userId) throw new Error('Not signed in')
  const row = {
    username: username.replace(/^@/, '').trim().toLowerCase(),
    added_by: userId,
    next_fetch_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('tracked_accounts')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data as TrackedAccount
}

export async function updateAccountSettings(
  username: string,
  settings: Partial<Pick<TrackedAccount, 'scrape_window_days' | 'scrape_interval_days'>>,
): Promise<void> {
  const { error } = await supabase
    .from('tracked_accounts')
    .update(settings)
    .eq('username', username)
  if (error) throw error
}

export async function removeTrackedAccount(username: string, deleteHistory = false): Promise<void> {
  if (deleteHistory) {
    await supabase.from('reel_snapshots').delete().eq('username', username)
    await supabase.from('account_snapshots').delete().eq('username', username)
  }
  const { error } = await supabase
    .from('tracked_accounts')
    .delete()
    .eq('username', username)
  if (error) throw error
}

export async function markFetchError(username: string, errorMsg: string): Promise<void> {
  const { error } = await supabase
    .from('tracked_accounts')
    .update({ last_error: errorMsg, last_error_at: new Date().toISOString() })
    .eq('username', username)
  if (error) throw error
}

export async function clearFetchError(username: string): Promise<void> {
  const { error } = await supabase
    .from('tracked_accounts')
    .update({ last_error: null, last_error_at: null })
    .eq('username', username)
  if (error) throw error
}

export async function setNextFetchAt(username: string, intervalDays: number): Promise<void> {
  const next = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('tracked_accounts')
    .update({ next_fetch_at: next })
    .eq('username', username)
  if (error) throw error
}

// ---------- account_snapshots ----------

export async function getAccountSnapshots(username: string): Promise<AccountSnapshot[]> {
  const { data, error } = await supabase
    .from('account_snapshots')
    .select('*')
    .eq('username', username)
    .order('fetched_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as AccountSnapshot[]
}

/**
 * Latest two snapshots only — for the list page, which renders the current value
 * plus a delta vs the previous fetch. Avoids a full unbounded SELECT * per account.
 * Returned ascending (oldest first) so [length-1] is latest, matching getAccountSnapshots.
 */
export async function getLatestTwoSnapshots(username: string): Promise<AccountSnapshot[]> {
  const { data, error } = await supabase
    .from('account_snapshots')
    .select('*')
    .eq('username', username)
    .order('fetched_at', { ascending: false })
    .limit(2)
  if (error) throw error
  return ((data ?? []) as AccountSnapshot[]).reverse()
}

export async function insertAccountSnapshot(
  row: Omit<AccountSnapshot, 'id'>,
): Promise<AccountSnapshot> {
  const { data, error } = await supabase
    .from('account_snapshots')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data as AccountSnapshot
}

// ---------- reel_snapshots ----------

export async function getReelSnapshots(
  username: string,
  fetchedAt?: string,
): Promise<ReelSnapshot[]> {
  let query = supabase
    .from('reel_snapshots')
    .select('*')
    .eq('username', username)
    .order('fetched_at', { ascending: true })
  if (fetchedAt) query = query.eq('fetched_at', fetchedAt)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ReelSnapshot[]
}

export async function getLatestReelSnapshots(username: string): Promise<ReelSnapshot[]> {
  const { data: latest, error: e1 } = await supabase
    .from('reel_snapshots')
    .select('fetched_at')
    .eq('username', username)
    .order('fetched_at', { ascending: false })
    .limit(1)
  if (e1) throw e1
  if (!latest || latest.length === 0) return []
  return getReelSnapshots(username, (latest[0] as { fetched_at: string }).fetched_at)
}

export async function insertReelSnapshots(rows: Omit<ReelSnapshot, 'id'>[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase.from('reel_snapshots').insert(rows)
  if (error) throw error
}
