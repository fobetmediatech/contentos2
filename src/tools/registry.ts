/**
 * PIPELINE_REGISTRY — maps pipelineType → PipelineToolDescriptor.
 *
 * Pure data, no hook calls, no side effects.
 * Each entry is the single source of truth for its pipeline's step labels and display name.
 *
 * Extension guide:
 *   1. Add a new PipelineToolDescriptor entry here with id, name, and steps.
 *   2. Add a tool record (declaration + Zod schema + toAction) in agentTools.ts.
 *   3. Add a dispatch branch in useAgentConversation.ts → dispatchTool().
 *   4. Add a result store (see analysisStore.ts / discoveryStore.ts pattern).
 *   5. Add a result message component and wire it into ChatPage's render block.
 */

import { STEP_LABELS } from '../store/analysisStore'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import type { PipelineToolDescriptor } from './types'

/** Steps shown in the reel/hook analysis progress (rendered inline by InlineReelResults). */
const reelSteps: string[] = ['Scraping reels', 'Analyzing hooks', 'Synthesizing patterns']

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
  },

  discovery: {
    id: 'discovery',
    name: 'Location Discovery',
    steps: discoverySteps,
  },

  reel: {
    id: 'reel',
    name: 'Reel Hook Analysis',
    steps: reelSteps,
  },
}
