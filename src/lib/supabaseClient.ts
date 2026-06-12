/**
 * The one Supabase client for the whole app — storage only (auth is Clerk).
 *
 * Every request carries the Clerk session JWT via the `accessToken` callback, so
 * Supabase RLS can scope rows by the Clerk user id (auth.jwt()->>'sub'). The token
 * getter is wired ONCE from App.tsx after Clerk loads (setClerkTokenGetter), which
 * lets module-level Zustand stores use this client without React hooks. Safe because
 * every store call happens behind the signed-in gate, so a token always exists by
 * the first query.
 *
 * Placeholder env fallbacks keep construction from throwing under Vitest (node),
 * where VITE_* are undefined; real calls are always mocked in tests.
 */
import { createClient } from '@supabase/supabase-js'
import { getClerkSessionToken } from './clerkToken'

// Token wiring lives in clerkToken.ts (shared with the deep-reel function
// caller); re-exported here so existing imports keep working.
export { setClerkTokenGetter } from './clerkToken'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const supabase = createClient(url, anonKey, {
  accessToken: async () => getClerkSessionToken(),
})
