/**
 * Shared constants — single source of truth for magic strings.
 *
 * T4: PROCEED_LABEL is used in both ChatOptions and useConversation.confirmSeeds()
 * to identify when the user chose to proceed without directional preference.
 */

/** Label for the "no directional preference" option in seed confirmation. */
export const PROCEED_LABEL = 'Looks right, proceed as-is'

/**
 * Option label shown in the discovery-pipeline confirming state.
 * When selected, redirects from location discovery to competitor analysis.
 * Matched in useConversation.confirmSeeds() — keep in sync with the options array.
 */
export const DISCOVERY_REDIRECT_TO_COMPETITOR = 'Actually, show me who dominates this niche globally'

/** Shared error message when Gemini API key is absent. Used in multiple useConversation paths. */
export const GEMINI_KEY_MISSING_MSG = 'Gemini API key missing. Add it in Settings.'
