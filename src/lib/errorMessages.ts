/**
 * Shared friendly-error maps — fixed, user-safe messages keyed by error code.
 *
 * SECURITY (C2/H11): the raw error.message is NEVER shown to the user — Apify and
 * Gemini response bodies can echo request internals, handles, or key fragments.
 * Callers map an error CODE to one of these fixed strings instead.
 *
 * Dependency-free on purpose: the pipeline hooks (useCompetitorAnalysis,
 * useLocationDiscovery) AND the Phase-1b agent-loop tool-failure handling import
 * from here, so this module must not pull in React, a store, or any heavy dep.
 */

export const APIFY_FRIENDLY: Record<string, string> = {
  QUOTA_EXCEEDED: 'Apify monthly usage limit reached — add a key from another account in Settings, upgrade your plan, or wait for the monthly reset.',
  RUN_START_FAILED: 'Scraping failed to start — try again or check your Apify key.',
  POLL_FAILED: 'Lost connection to Apify while scraping — try again.',
  RUN_FAILED: 'The scrape failed on Apify — try again with different handles.',
  RUN_TIMEOUT: 'Scraping took too long on Apify — try again with fewer handles.',
  RUN_ABORTED: 'The scrape was stopped — try again.',
  POLL_TIMEOUT: 'Scraping took too long — try again with fewer handles.',
  DATASET_FETCH_FAILED: "Couldn't fetch results from Apify — try again.",
  ABORTED: 'Scraping was cancelled.',
}

export const GEMINI_FRIENDLY: Record<string, string> = {
  AUTH_ERROR: 'Gemini API key is invalid or missing — update it in Settings.',
  RATE_LIMITED: 'Gemini rate limit hit — wait a few seconds and try again.',
  SAFETY_BLOCK: 'The AI declined this request — try different inputs.',
  INVALID_PROMPT: 'AI analysis failed on the input — try again.',
  PARSE_ERROR: 'The AI returned an unexpected response — try again.',
  INTERNAL_ERROR: 'Gemini had an internal error — try again in a moment.',
  UNAVAILABLE: 'Gemini is temporarily unavailable — try again shortly.',
  UNKNOWN: 'AI analysis failed — try again.',
}

/** Map an ApifyError code to a fixed, user-safe message (with a sane default). */
export function friendlyApify(code: string): string {
  return APIFY_FRIENDLY[code] ?? 'Scraping failed — try again or check your Apify key.'
}

/** Map a GeminiError code to a fixed, user-safe message (with a sane default). */
export function friendlyGemini(code: string): string {
  return GEMINI_FRIENDLY[code] ?? 'AI analysis failed — try again.'
}

/**
 * Empty-candidate-pool message for the competitor pipeline. A reference handle that doesn't exist
 * (or has no public related accounts) yields zero candidates — the pipeline fails fast with this
 * instead of running clarification + 2 minutes of ranking only to dead-end on the confusing "no
 * verified competitors found". `refFound` distinguishes "handle not found at all" from "found,
 * but it has nothing adjacent to compare against". Built ONLY from the user's own input handles +
 * fixed copy (never a raw API body), so it's user-safe per the C2/H11 rule above.
 */
export function sparseSeedMessage(handles: string[], refFound: boolean): string {
  const subject = handles.map((h) => `@${h.replace(/^@+/, '')}`).join(', ') || 'that account'
  if (!refFound) {
    return `Couldn't find ${subject} on Instagram — double-check the handle (it may be private, renamed, or misspelled).`
  }
  const verb = handles.length > 1 ? 'have' : 'has'
  return `${subject} ${verb} no related public accounts to compare against. Try a more established reference account in the same niche.`
}

/**
 * Shown when the dismissed-filter (Phase 3, 3a) empties an otherwise non-empty candidate pool —
 * i.e. every account found was one the user previously dismissed. Distinct from the
 * handle-not-found case so the fix is clear: clear some dismissals, don't change the handle.
 */
export const ALL_DISMISSED_MESSAGE =
  "Every account found here is one you've dismissed before. Clear some dismissals in Memory, or try a different reference account."
