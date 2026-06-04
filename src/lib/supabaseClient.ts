import { createClient } from '@supabase/supabase-js'

// Public, build-time creds (safe in the bundle). PKCE flow: the magic link returns with
// ?code=…, which detectSessionInUrl exchanges for a session on load, before routing.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

// Loud signal if a PROD build is missing its Supabase env. The placeholder fallbacks above keep
// import-time safe for tests/CI, but would otherwise let a misconfigured prod build boot silently
// (login would just fail with the generic error). Env-presence check only — never logs the values.
if (import.meta.env.PROD && (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY)) {
  console.error('[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — auth will not work. Set them in the Vercel project env and rebuild.')
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
