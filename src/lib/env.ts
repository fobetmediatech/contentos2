import { z } from 'zod'

/**
 * Centralized client-side env validation (item 7.6).
 *
 * After Phase 1, the only VITE_ vars the browser needs are Clerk and Supabase.
 * Gemini and Apify keys live server-side (process.env, not import.meta.env).
 *
 * envErrors is non-empty when the deployment is misconfigured. App.tsx surfaces
 * it as a visible banner so the team can diagnose quickly.
 */
const schema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: z.string().startsWith('pk_', {
    message: 'Must start with pk_ — get from clerk.com → Your App → API Keys',
  }),
  VITE_SUPABASE_URL: z.string().url({
    message: 'Must be a valid URL — get from Supabase → Project Settings → API',
  }),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, {
    message: 'Required — get from Supabase → Project Settings → API',
  }),
})

const result = schema.safeParse({
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '',
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL ?? '',
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
})

export const envErrors: string[] = result.success
  ? []
  : result.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`)
