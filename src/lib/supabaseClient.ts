import { createClient } from '@supabase/supabase-js'

// Public, build-time creds (safe in the bundle). PKCE flow: the magic link returns with
// ?code=…, which detectSessionInUrl exchanges for a session on load, before routing.
const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
