/**
 * Async PersistStorage<T> backed by the private `user_state` table (jsonb value).
 *
 * Replaces safePersistStorage (localStorage) for the conversations + reel stores under
 * cloud-first. Implements Zustand's OBJECT-based PersistStorage (not StateStorage +
 * createJSONStorage): the column is jsonb, so we store/return the { state, version }
 * envelope object directly — no JSON string round-trip.
 *
 * user_id is server-defaulted from the Clerk JWT (auth.jwt()->>'sub'), and RLS scopes
 * every row to the caller — so the adapter only ever sends/filters by `key`.
 *
 * Phase 2.7: Gate setItem on successful hydration. If getItem throws (failed rehydrate),
 * setItem becomes a no-op for that key until the next successful getItem. This prevents
 * a blank-state write from overwriting the user's cloud history.
 *
 * Phase 2.8: setItem retries twice with 1s backoff on transient network errors before
 * silently swallowing — the store must never crash just because a sync write failed.
 *
 * Phase 6.1: Trailing debounce (3s) per key so every Zustand set() doesn't fire a
 * multi-hundred-KB upsert. Pending writes flush immediately on visibilitychange (tab
 * hide/close) so no data is lost when the user navigates away mid-run.
 */
import type { PersistStorage, StorageValue } from 'zustand/middleware'
import { supabase } from '../lib/supabaseClient'

const RETRY_DELAY_MS = 1000
const MAX_RETRIES = 2
const DEBOUNCE_MS = 3000

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function upsertWithRetry(key: string, value: unknown): Promise<void> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS)
    try {
      const { error } = await supabase
        .from('user_state')
        .upsert({ key, value }, { onConflict: 'user_id,key' })
      if (error) throw error
      return
    } catch (err) {
      lastErr = err
    }
  }
  if (import.meta.env.DEV) console.warn('[supabaseStorage] setItem failed after retries', lastErr)
}

export function makeSupabaseStorage<T>(): PersistStorage<T> {
  // Keys for which getItem has returned successfully at least once this session.
  // setItem is gated on this set so a failed rehydrate can't wipe cloud data.
  const hydratedKeys = new Set<string>()

  // Debounce state: pending value + timer handle per key.
  const pending = new Map<string, { value: StorageValue<T>; timer: ReturnType<typeof setTimeout> }>()

  const flush = (key: string) => {
    const entry = pending.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(key)
    void upsertWithRetry(key, entry.value)
  }

  const flushAll = () => {
    for (const key of pending.keys()) flush(key)
  }

  // Flush on tab hide/close so in-flight debounced writes aren't lost.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAll()
    })
  }

  return {
    getItem: async (key) => {
      const { data, error } = await supabase
        .from('user_state')
        .select('value')
        .eq('key', key)
        .maybeSingle()
      if (error) throw error
      // Only mark hydrated after a successful fetch — a throw above skips this.
      hydratedKeys.add(key)
      return data ? (data as { value: StorageValue<T> }).value : null
    },

    setItem: (key, value) => {
      // 2.7: refuse to write until we've confirmed the cloud state is loaded.
      if (!hydratedKeys.has(key)) return

      // 6.1: coalesce rapid writes — reset the timer, keep only the latest value.
      const existing = pending.get(key)
      if (existing) clearTimeout(existing.timer)
      const timer = setTimeout(() => flush(key), DEBOUNCE_MS)
      pending.set(key, { value, timer })
    },

    removeItem: async (key) => {
      // Cancel any pending debounced write for this key before deleting.
      const entry = pending.get(key)
      if (entry) { clearTimeout(entry.timer); pending.delete(key) }
      hydratedKeys.delete(key)
      await supabase.from('user_state').delete().eq('key', key)
    },
  }
}

/** Shared singleton — the two private stores both use it (keyed by their persist `name`). */
export const supabaseStorage = makeSupabaseStorage<unknown>()
