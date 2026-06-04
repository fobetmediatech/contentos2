import { createClient } from '@supabase/supabase-js'

// Public, build-time creds (safe in the bundle). PKCE flow: the magic link returns with
// ?code=…, which detectSessionInUrl exchanges for a session on load, before routing.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
