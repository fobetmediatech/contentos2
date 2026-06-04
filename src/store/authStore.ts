import { create } from 'zustand'
import type { Session, User, SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export interface AuthState {
  session: Session | null
  user: User | null
  status: AuthStatus
  init: () => Promise<void>
  signInWithEmail: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export function makeAuthStore(client: SupabaseClient) {
  let initialized = false
  return create<AuthState>((set) => ({
    session: null,
    user: null,
    status: 'loading',
    init: async () => {
      if (initialized) return // idempotent — StrictMode double-invoke safe
      initialized = true
      client.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null, status: session ? 'signed-in' : 'signed-out' })
      })
      const { data } = await client.auth.getSession()
      set({
        session: data.session,
        user: data.session?.user ?? null,
        status: data.session ? 'signed-in' : 'signed-out',
      })
    },
    signInWithEmail: async (email) => {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      return { error: error ? 'Could not send the magic link — try again shortly.' : null }
    },
    signOut: async () => {
      await client.auth.signOut()
      set({ session: null, user: null, status: 'signed-out' })
    },
  }))
}

export const useAuthStore = makeAuthStore(supabase)
