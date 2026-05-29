/**
 * Analysis state store — tracks the current analysis run.
 *
 * Status lifecycle:
 *   idle → running (discovery) → clarifying (waiting for user input) → running (ranking) → done
 *                                                                    ↓ error at any point
 */

import { create } from 'zustand'
import type { NormalizedProfile } from '../lib/transformers'
import type { CompetitorAnalysisResult, AnalysisOutput, ClarificationQuestion } from '../ai/prompts'

export type AnalysisStep = 1 | 2 | 3 | 4 | 5

export const STEP_LABELS: Record<AnalysisStep, string> = {
  1: 'Scraping reference accounts',
  2: 'Discovering competitors by niche',
  3: 'Scraping competitor profiles',
  4: 'Ranking by engagement and growth',
  5: 'Generating AI rationale',
}

export type AnalysisStatus = 'idle' | 'running' | 'clarifying' | 'done' | 'error'

export interface AnalysisParams {
  handles: string[]
  depth: 'standard' | 'deep'
  clientName: string
  /** Strategist-provided niche description. Optional — clarification step covers it when absent. */
  nicheContext: string
}

/** Data held in the store during the clarification pause (between discovery and ranking). */
export interface PendingDiscovery {
  inputProfiles: NormalizedProfile[]
  candidateProfiles: NormalizedProfile[]
  clarificationQuestion: ClarificationQuestion
}

export interface AnalysisState {
  status: AnalysisStatus
  currentStep: AnalysisStep
  params: AnalysisParams | null

  /** Populated when status === 'clarifying'. Cleared on reset. */
  pendingDiscovery: PendingDiscovery | null
  /** Set by answerClarification(); read by analyzeMutation to inject into ranking prompt. */
  clarificationAnswer: string | null

  inputProfiles: NormalizedProfile[]
  competitors: CompetitorAnalysisResult[]
  niche: string
  summary: string
  error: string | null

  // Actions
  startAnalysis: (params: AnalysisParams) => void
  setStep: (step: AnalysisStep) => void
  /** Transitions status to 'clarifying' and stores discovery data + generated question. */
  setClarification: (data: PendingDiscovery) => void
  /** Stores the user's clarification answer and transitions back to 'running'. */
  answerClarification: (answer: string) => void
  setResults: (output: AnalysisOutput, inputProfiles: NormalizedProfile[]) => void
  setError: (message: string) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as AnalysisStatus,
  currentStep: 1 as AnalysisStep,
  params: null,
  pendingDiscovery: null,
  clarificationAnswer: null,
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

  setClarification: (data) =>
    set({ status: 'clarifying', pendingDiscovery: data }),

  answerClarification: (answer) =>
    set({ status: 'running', clarificationAnswer: answer }),

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
