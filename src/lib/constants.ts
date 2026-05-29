/**
 * Shared constants — single source of truth for magic strings.
 *
 * T4: PROCEED_LABEL is used in both ChatOptions and useConversation.confirmSeeds()
 * to identify when the user chose to proceed without directional preference.
 */

/** Label for the "no directional preference" option in seed confirmation. */
export const PROCEED_LABEL = 'Looks right, proceed as-is'

/** Direction options shown in the confirming state. */
export const DIRECTION_OPTIONS = [
  'Focus on micro-influencers (< 100K followers)',
  'Focus on macro creators (> 100K followers)',
  'Mix of creator sizes',
  'Include businesses and brands',
] as const
