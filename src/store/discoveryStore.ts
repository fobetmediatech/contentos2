/**
 * Discovery state store — tracks the current location discovery run.
 *
 * Mirrors the analysisStore pattern but with discovery-specific steps and output shape.
 */

import { create } from 'zustand'
import type { NormalizedProfile } from '../lib/transformers'
import type { DiscoveryResult, DiscoveryOutput } from '../ai/prompts'

// ----- Steps -----

export type DiscoveryStep = 1 | 2 | 3 | 4 | 5 | 6

export const DISCOVERY_STEP_LABELS: Record<number, string> = {
  1: 'Generating location hashtags',
  2: 'Scraping location-tagged posts',
  3: 'Fetching creator profiles',
  4: 'Filtering by location signals',
  5: 'Generating AI insights',
  6: 'Expanding search',   // only rendered when quality gate triggers
}

// ----- Params -----

export interface DiscoveryParams {
  city: string
  niche: string
  depth: 'standard' | 'deep'
  clientName: string
}

// ----- State -----

export type DiscoveryStatus = 'idle' | 'running' | 'done' | 'error'

export interface DiscoveryState {
  status: DiscoveryStatus
  currentStep: DiscoveryStep
  params: DiscoveryParams | null
  /** Conversation the run started in — results + errors route here via addMessageTo (2.1). */
  runConversationId: string | null
  /** All profiles that were scraped (before AI selection) */
  candidateProfiles: NormalizedProfile[]
  /** The 10 results Gemini selected */
  results: DiscoveryResult[]
  /** Detected niche label from Gemini */
  niche: string
  /** Whether location filter was relaxed (too few bio matches) */
  locationFilterRelaxed: boolean
  /** Hashtags that were actually scraped */
  sourceHashtags: string[]
  error: string | null
  /** Detail text shown in the progress bubble during expansion (step 6) */
  stepProgressDetail: string | null
  /** True when the quality gate triggered and a second pass ran */
  didExpand: boolean

  // Actions
  startDiscovery: (params: DiscoveryParams, runConversationId?: string) => void
  setStep: (step: DiscoveryStep) => void
  setStepProgressDetail: (detail: string | null) => void
  setResults: (
    output: DiscoveryOutput,
    candidateProfiles: NormalizedProfile[],
    locationFilterRelaxed: boolean,
    sourceHashtags: string[],
    didExpand?: boolean,
  ) => void
  setError: (message: string) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as DiscoveryStatus,
  currentStep: 1 as DiscoveryStep,
  params: null,
  runConversationId: null as string | null,
  candidateProfiles: [],
  results: [],
  niche: '',
  locationFilterRelaxed: false,
  sourceHashtags: [],
  error: null,
  stepProgressDetail: null as string | null,
  didExpand: false,
}

export const useDiscoveryStore = create<DiscoveryState>()((set) => ({
  ...initialState,

  startDiscovery: (params, runConversationId) =>
    set({ ...initialState, status: 'running', params, currentStep: 1, runConversationId: runConversationId ?? null }),

  setStep: (step) => set({ currentStep: step }),

  setStepProgressDetail: (detail) => set({ stepProgressDetail: detail }),

  setResults: (output, candidateProfiles, locationFilterRelaxed, sourceHashtags, didExpand = false) =>
    set({
      status: 'done',
      results: output.results,
      niche: output.niche,
      candidateProfiles,
      locationFilterRelaxed,
      sourceHashtags,
      didExpand,
      stepProgressDetail: null, // clear expansion detail so done-card shows city correctly
    }),

  setError: (message) => set({ status: 'error', error: message, currentStep: 1 }),

  reset: () => set(initialState),
}))
