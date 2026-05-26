/**
 * Analysis state store — tracks the current analysis run.
 */

import { create } from 'zustand'
import type { NormalizedProfile } from '../lib/transformers'
import type { CompetitorAnalysisResult, AnalysisOutput } from '../ai/prompts'

export type AnalysisStep = 1 | 2 | 3 | 4 | 5

export const STEP_LABELS: Record<AnalysisStep, string> = {
  1: 'Scraping reference accounts',
  2: 'Discovering competitors by niche',
  3: 'Scraping competitor profiles',
  4: 'Ranking by engagement and growth',
  5: 'Generating AI rationale',
}

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error'

export interface AnalysisParams {
  handles: string[]
  depth: 'standard' | 'deep'
  clientName: string
  /** Strategist-provided niche description. Injected into Gemini as explicit context. Required. */
  nicheContext: string
}

export interface AnalysisState {
  status: AnalysisStatus
  currentStep: AnalysisStep
  params: AnalysisParams | null
  inputProfiles: NormalizedProfile[]
  competitors: CompetitorAnalysisResult[]
  niche: string
  summary: string
  error: string | null

  // Actions
  startAnalysis: (params: AnalysisParams) => void
  setStep: (step: AnalysisStep) => void
  setResults: (output: AnalysisOutput, inputProfiles: NormalizedProfile[]) => void
  setError: (message: string) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as AnalysisStatus,
  currentStep: 1 as AnalysisStep,
  params: null,
  inputProfiles: [],
  competitors: [],
  niche: '',
  summary: '',
  error: null,
}

export const useAnalysisStore = create<AnalysisState>()((set) => ({
  ...initialState,

  startAnalysis: (params) =>
    set({ ...initialState, status: 'running', params, currentStep: 1 }),

  setStep: (step) => set({ currentStep: step }),

  setResults: (output, inputProfiles) =>
    set({
      status: 'done',
      competitors: output.competitors,
      niche: output.niche,
      summary: output.summary,
      inputProfiles,
    }),

  setError: (message) => set({ status: 'error', error: message }),

  reset: () => set(initialState),
}))
