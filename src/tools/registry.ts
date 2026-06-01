/**
 * PIPELINE_REGISTRY — maps pipelineType → PipelineToolDescriptor.
 *
 * Pure data, no hook calls, no side effects.
 * Each entry is the single source of truth for its pipeline's UI metadata.
 *
 * Extension guide:
 *   1. Add a new PipelineToolDescriptor entry here.
 *   2. Add a dispatch case in useConversation.ts → confirmSeeds().
 *   That's it — ChatPage and useActivePipeline pick it up automatically.
 */

import { STEP_LABELS } from '../store/analysisStore'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import { PROCEED_LABEL, DISCOVERY_REDIRECT_TO_COMPETITOR } from '../lib/constants'
import type { PipelineToolDescriptor, ResolvedIntent } from './types'

const competitorSteps: string[] = Object.values(STEP_LABELS)
// Only steps 1-5 in the static registry — step 6 ("Expanding search") is
// conditionally added at runtime by useActivePipeline when the quality gate fires.
const discoverySteps: string[] = Object.entries(DISCOVERY_STEP_LABELS)
  .filter(([k]) => Number(k) <= 5)
  .map(([, v]) => v)

export const PIPELINE_REGISTRY: Record<string, PipelineToolDescriptor> = {
  competitor: {
    id: 'competitor',
    name: 'Competitor Analysis',
    steps: competitorSteps,
    /**
     * Unused at runtime — the competitor confirming message is built in
     * useConversation.ts after runCompetitorDiscovery() returns (not here).
     * Kept for interface completeness; use this field if the competitor
     * pipeline is ever refactored to use the registry confirm path.
     */
    confirmMessage: (intent: ResolvedIntent) => {
      const niche = 'niche' in intent ? intent.niche : ''
      const location = 'location' in intent ? (intent.location ?? '') : ''
      return `Found accounts in the **${niche}** space${location ? ` in ${location}` : ''}. Which direction should I focus on?`
    },
    confirmOptions: () => [
      PROCEED_LABEL,
      'Micro-influencers (under 100K followers)',
      'Macro creators (100K+ followers)',
      'Include businesses and brands',
    ],
    resultsPath: '/results',
  },

  discovery: {
    id: 'discovery',
    name: 'Location Discovery',
    steps: discoverySteps,
    confirmMessage: (intent: ResolvedIntent) => {
      const niche = 'niche' in intent ? intent.niche : ''
      const location = 'location' in intent ? (intent.location ?? '') : ''
      return `Running **location discovery** — finding ${niche} creators physically based in **${location}**. Say "go" to start, or type what you actually want.\n\nWrong pipeline? Try typing "show me who dominates this niche globally" instead.`
    },
    confirmOptions: () => [PROCEED_LABEL, DISCOVERY_REDIRECT_TO_COMPETITOR],
    resultsPath: '/discover/results',
  },
}
