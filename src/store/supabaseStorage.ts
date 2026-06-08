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
 */
import type { PersistStorage, StorageValue } from 'zustand/middleware'
import { supabase } from '../lib/supabaseClient'

export function makeSupabaseStorage<T>(): PersistStorage<T> {
  return {
    getItem: async (key) => {
      const { data, error } = await supabase
        .from('user_state')
        .select('value')
        .eq('key', key)
        .maybeSingle()
      if (error || !data) return null
      return (data as { value: StorageValue<T> }).value
    },
    setItem: async (key, value) => {
      const { error } = await supabase
        .from('user_state')
        .upsert({ key, value }, { onConflict: 'user_id,key' })
      if (error) throw error
    },
    removeItem: async (key) => {
      await supabase.from('user_state').delete().eq('key', key)
    },
  }
}

/** Shared singleton — the two private stores both use it (keyed by their persist `name`). */
export const supabaseStorage = makeSupabaseStorage<unknown>()
