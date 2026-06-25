/**
 * PIPELINE_REGISTRY — maps pipelineType → PipelineToolDescriptor.
 *
 * Pure data, no hook calls, no side effects.
 * Each entry is the single source of truth for its pipeline's step labels and display name.
 *
 * Full extension guide: see "Adding a new pipeline" in CLAUDE.md.
 * Short version: tool entry in agentTools.ts → dispatch branch → store → hook → ResultMessage → entry here.
 */

import { STEP_LABELS } from '../store/analysisStore'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import type { PipelineToolDescriptor } from './types'

/** Steps shown in the reel/hook analysis progress (rendered inline by InlineReelResults). */
const reelSteps: string[] = ['Scraping reels', 'Analyzing hooks', 'Synthesizing patterns']

/**
 * Phases of a single-reel case study (rendered inline by SingleReelResultMessage,
 * which reads the store's free-form `progress` label rather than an indexed step bar).
 * Listed here so the registry stays a complete catalog of pipelines.
 */
const singleReelSteps: string[] = ['Scraping reel', 'Analyzing hook & psychology']

const repurposeSteps = [
  'Building the client voice profile',
  'Analyzing the source reel',
  'Rewriting in the client voice',
]

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

  'single-reel': {
    id: 'single-reel',
    name: 'Single Reel Case Study',
    steps: singleReelSteps,
  },

  repurpose: {
    id: 'repurpose',
    name: 'Repurpose Reel',
    steps: repurposeSteps,
  },
}
