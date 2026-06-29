/**
 * Shared friendly-error maps — fixed, user-safe messages keyed by error code.
 *
 * SECURITY (C2/H11): the raw error.message is NEVER shown to the user — Apify and
 * Gemini response bodies can echo request internals, handles, or key fragments.
 * Callers map an error CODE to one of these fixed strings instead.
 *
 * No React, no store, no heavy deps — this is imported by pipeline hooks AND
 * the agent-loop tool-failure handler.
 */

import { ApifyError } from './apifyCore'
import { GeminiError } from '../ai/gemini'

/**
 * Shown when a scrape hangs, times out, or fails outright. During an Instagram-side
 * anti-scraping block that's what every run does — it starts, then never finishes — and
 * the old "try fewer handles" copy wrongly blamed the user's input (so they retried,
 * adding load). True as a general explanation too: with our generous poll budgets a
 * timeout/failure is almost always upstream, not the input. Safe to keep permanently;
 * to drop the provider mention later, point the three codes below back at plain copy.
 */
export const PROVIDER_BLOCKED_MESSAGE =
  'Instagram scraping is temporarily unavailable — our data provider (Apify) is being blocked by Instagram. This is a known upstream issue that usually clears within a few hours, not a problem with your input. Please try again later.'

export const APIFY_FRIENDLY: Record<string, string> = {
  QUOTA_EXCEEDED: 'Apify monthly usage limit reached — add a key from another account to APIFY_KEY_N in the server environment, upgrade your plan, or wait for the monthly reset.',
  RUN_START_FAILED: 'Scraping failed to start — try again or check your Apify key.',
  POLL_FAILED: 'Lost connection to Apify while scraping — try again.',
  RUN_FAILED: PROVIDER_BLOCKED_MESSAGE,
  RUN_TIMEOUT: PROVIDER_BLOCKED_MESSAGE,
  RUN_ABORTED: 'The scrape was stopped — try again.',
  POLL_TIMEOUT: PROVIDER_BLOCKED_MESSAGE,
  DATASET_FETCH_FAILED: "Couldn't fetch results from Apify — try again.",
  ABORTED: 'Scraping was cancelled.',
}

export const GEMINI_FRIENDLY: Record<string, string> = {
  AUTH_ERROR: 'Gemini API key is invalid or missing — check GEMINI_API_KEY in the server environment.',
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
 * Map ANY thrown error to a fixed, user-safe message — ApifyError/GeminiError go through
 * their code maps; everything else falls back to `fallback`. NEVER returns raw err.message
 * (C2/H11: Apify/Gemini bodies can echo handles or key fragments). Use this anywhere a
 * pipeline would otherwise surface `(err as Error).message` straight to the UI.
 */
export function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof ApifyError) return friendlyApify(err.code)
  if (err instanceof GeminiError) return friendlyGemini(err.code)
  return fallback
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

/**
 * Shown on "Start over" when the conversation has already collected the full target of relevant
 * (non-thumbs-downed) competitors — no re-scrape needed.
 */
export const alreadyCollectedMessage = (n: number): string =>
  `You've collected ${n} relevant competitors. Thumbs-down any you want to replace, then Start over to find more.`

/**
 * Shown when a re-run finds no new candidates before reaching the target — Instagram's
 * related-account graph for these handles is exhausted.
 */
export const poolExhaustedMessage = (relevant: number): string =>
  `Found ${relevant} relevant so far — Instagram's related-account pool for these handles is exhausted. Try adding another reference handle.`

const NETWORK_BLOCKED_MESSAGE =
  "Network blocked — could not reach Apify API. If you're using Brave browser, click the Brave shield icon in the address bar and turn off \"Block trackers & ads\" for localhost, then try again."

/**
 * Shared pipeline error → user-safe message mapper used by both competitor and discovery hooks.
 *
 * `timeoutMsg`    — passed so each pipeline can name itself in the timeout copy.
 * `pickKey`       — determines whether a follow-up key is available after a rate-limit.
 *
 * SECURITY (C2/H11): ApifyError and GeminiError codes map to FIXED strings only —
 * raw Apify/Gemini response bodies NEVER reach the user.
 */
export function buildPipelineErrorMessage(
  err: unknown,
  signal: AbortSignal,
  pickKey: () => string | null,
  timeoutMsg: string = 'Analysis timed out after 150 seconds. Try with fewer handles or check your Apify key.',
): string {
  if (signal.aborted) return timeoutMsg
  if (err instanceof ApifyError) {
    if (err.code === 'RATE_LIMITED') {
      return `Apify key rate limited and placed in 15-minute cooldown. ${
        pickKey() ? 'Retrying with next key — please try again.' : 'All keys are in cooldown.'
      }`
    }
    return friendlyApify(err.code)
  }
  if (err instanceof GeminiError) return friendlyGemini(err.code)
  if (err instanceof TypeError && err.message.includes('fetch')) return NETWORK_BLOCKED_MESSAGE
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred.'
}
