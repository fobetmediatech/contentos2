/**
 * Google authorization for export — a dedicated OAuth popup via Google Identity Services (GIS),
 * independent of Clerk sign-in.
 *
 * Why not reuse the Clerk Google login? That token only carries profile/email scope; Google
 * Drive write access (drive.file) can't be attached to it on most Clerk instances, so exports
 * looped forever on "connect Google". GIS requests drive.file directly in a popup and returns a
 * usable access token to the browser — the standard client-side "export to Google" pattern.
 *
 * IMPORTANT: requestGoogleToken() opens a popup, so it MUST be called synchronously from within
 * a user gesture (a click handler), before any await. GIS is preloaded on mount so the token
 * client is ready by click time. A valid token is cached in memory to avoid a popup on every
 * export.
 */

/** Per-file Drive scope — non-sensitive (files this app creates only), no Google verification. */
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}
interface TokenClient {
  callback: (resp: TokenResponse) => void
  requestAccessToken: (overrides?: { prompt?: string }) => void
}
interface GisNamespace {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (resp: TokenResponse) => void
        error_callback?: (err: { type?: string; message?: string }) => void
      }) => TokenClient
    }
  }
}
function gis(): GisNamespace | undefined {
  return (globalThis as unknown as { google?: GisNamespace }).google
}

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

/** The public OAuth client id (safe to expose); empty when export isn't configured yet. */
export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
}
export function isGoogleExportConfigured(): boolean {
  return googleClientId().length > 0
}

let gisPromise: Promise<void> | null = null
let tokenClient: TokenClient | null = null
let cached: { token: string; expiresAt: number } | null = null
// The in-flight request's handlers — GIS delivers the result through the client's single callback.
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

/** Inject the GIS script once. Idempotent; safe to call on every button mount. */
export function loadGoogleIdentity(): Promise<void> {
  if (gisPromise) return gisPromise
  gisPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new GoogleAuthError('No document'))
    if (gis()?.accounts?.oauth2) return resolve()
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    const onload = () => resolve()
    const onerror = () => reject(new GoogleAuthError('Failed to load Google Identity Services'))
    if (existing) {
      existing.addEventListener('load', onload)
      existing.addEventListener('error', onerror)
      return
    }
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.addEventListener('load', onload)
    s.addEventListener('error', onerror)
    document.head.appendChild(s)
  })
  return gisPromise
}

function ensureTokenClient(): TokenClient {
  const ns = gis()
  if (!ns?.accounts?.oauth2) throw new GoogleAuthError('Google auth not ready yet — try again in a second')
  if (!tokenClient) {
    tokenClient = ns.accounts.oauth2.initTokenClient({
      client_id: googleClientId(),
      scope: SCOPE,
      callback: (resp) => {
        const p = pending
        pending = null
        if (!p) return
        if (resp.error || !resp.access_token) {
          p.reject(new GoogleAuthError(resp.error_description || resp.error || 'Authorization failed'))
          return
        }
        cached = { token: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 }
        p.resolve(resp.access_token)
      },
      error_callback: (err) => {
        const p = pending
        pending = null
        // popup_closed / popup_failed_to_open / user cancelled
        if (p) p.reject(new GoogleAuthError(err.message || 'Google authorization was cancelled'))
      },
    })
  }
  return tokenClient
}

/**
 * Get a Google access token with drive.file scope. Returns a cached token when still valid,
 * otherwise opens the GIS consent popup. MUST be invoked synchronously inside a click handler.
 */
export function requestGoogleToken(): Promise<string> {
  if (!isGoogleExportConfigured()) {
    return Promise.reject(new GoogleAuthError('Google export is not configured (missing VITE_GOOGLE_CLIENT_ID)'))
  }
  // Reuse a still-valid token (>60s left) so repeat exports don't re-prompt.
  if (cached && cached.expiresAt - Date.now() > 60_000) return Promise.resolve(cached.token)

  return new Promise<string>((resolve, reject) => {
    let client: TokenClient
    try {
      client = ensureTokenClient()
    } catch (e) {
      reject(e as Error)
      return
    }
    if (pending) pending.reject(new GoogleAuthError('Superseded by a newer request'))
    pending = { resolve, reject }
    try {
      client.requestAccessToken() // opens the popup; empty prompt → only asks when needed
    } catch {
      pending = null
      reject(new GoogleAuthError('Could not open the Google authorization popup'))
    }
  })
}

/** Test seam: drop the cached token (used by unit tests / sign-out). */
export function _clearGoogleTokenCache(): void {
  cached = null
}
