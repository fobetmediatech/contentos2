/**
 * Shared constants — single source of truth for magic strings.
 */

/** Label for the "no directional preference" option in clarification cards. */
export const PROCEED_LABEL = 'Looks right, proceed as-is'

/** Shared error message when Gemini API key is absent. */
export const GEMINI_KEY_MISSING_MSG = 'Gemini API key missing. Set GEMINI_API_KEY in the server environment (Vercel dashboard).'

/** Max characters accepted in the chat composer. Enforced in the UI (textarea
 *  maxLength) AND in sendMessage — both MUST read this so they never drift and
 *  silently truncate. ~1k tokens; well under Gemini's limits. */
export const MAX_INPUT_CHARS = 4000
