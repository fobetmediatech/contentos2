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
let inflight: Promise<string | null> | null = null

/** Wire the Clerk token source. Called once from App.tsx on sign-in. */
export function setClerkTokenGetter(fn: () => Promise<string | null>): void {
  getClerkToken = fn
}

/**
 * Current Clerk session JWT, or null when signed out / not yet wired.
 *
 * Concurrent callers are COALESCED onto a single in-flight getToken() call. The deep report
 * fires a burst of proxy requests at once (pLimit), and concurrent Clerk getToken() calls
 * during a token-refresh window can resolve null — which drops the Authorization header and
 * 401s the request (sequential apify polls never collided, so only the bursty reel-analyze
 * path failed). Sharing one fetch makes the whole burst use the same valid token.
 */
export async function getClerkSessionToken(): Promise<string | null> {
  if (!getClerkToken) return null
  if (inflight) return inflight
  const fetcher = getClerkToken
  // While a fetch is in flight, all callers share it; clear the slot once it settles so the
  // next call mints a fresh token. No newer in-flight can exist meanwhile (callers above
  // reuse this one), so an unconditional reset is safe.
  inflight = fetcher().finally(() => { inflight = null })
  return inflight
}

/**
 * Current Clerk user id — the JWT `sub` claim, decoded client-side.
 *
 * Some Supabase writes need the user id in the row itself (e.g. corpus_feedback.user_id,
 * whose insert RLS requires `user_id = auth.jwt()->>'sub'`); decoding the already-attached
 * session token avoids threading the id through every caller. Returns null when signed out,
 * not yet wired, or the token can't be parsed — callers treat that as "skip" (never throw).
 */
export async function getClerkUserId(): Promise<string | null> {
  const token = await getClerkSessionToken()
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    let b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    b64 += '='.repeat((4 - (b64.length % 4)) % 4) // restore base64url padding
    const sub = (JSON.parse(atob(b64)) as { sub?: unknown }).sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}
