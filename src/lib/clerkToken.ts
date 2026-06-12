/**
 * Clerk session-token access for plain (non-React) modules.
 *
 * The token getter is wired ONCE from App.tsx after Clerk loads
 * (setClerkTokenGetter), which lets module-level code — the Supabase client,
 * the deep-reel function caller — attach the session JWT without React hooks.
 * Safe because every caller runs behind the signed-in gate, so a token always
 * exists by the first use; returns null when signed out / not yet wired.
 */

let getClerkToken: (() => Promise<string | null>) | null = null

/** Wire the Clerk token source. Called once from App.tsx on sign-in. */
export function setClerkTokenGetter(fn: () => Promise<string | null>): void {
  getClerkToken = fn
}

/** Current Clerk session JWT, or null when signed out / not yet wired. */
export async function getClerkSessionToken(): Promise<string | null> {
  return getClerkToken ? await getClerkToken() : null
}
