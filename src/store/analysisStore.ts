/**
 * Analysis state store — tracks the current analysis run.
 *
 * Full status lifecycle (conversational + analysis):
 *
 *   idle → chatting → discovering → confirming → running → clarifying → done
 *                ↑         │               │                           ↓ error
 *                └─────────┘ (0 seeds)     └──── analyze() ───────────┘
 *
 * chatting    — user types intent; assistant may ask one clarification turn
 * discovering — generateHashtags() + scrapeHashtagUsernames() running (up to 90s)
 * confirming  — seeds shown, user picks direction or proceeds
 * running     — existing analysis pipeline (unchanged, 150s timeout)
 * clarifying  — existing ClarificationCard logic surfaced as chat bubble
 * done|error  — unchanged
 */

import { create } from 'zustand'
import type { NormalizedProfile } from '../lib/transformers'
import type { CompetitorAnalysisResult, AnalysisOutput, ClarificationQuestion } from '../ai/prompts'

// Re-export domain types so existing imports of `analysisStore` keep working unchanged.
export type { CompetitorResultPayload, DiscoveryResultPayload, ReelResultPayload, ResultPayload, ChatMessage } from '../domain/chat'

export type AnalysisStep = 1 | 2 | 3 | 4 | 5

export const STEP_LABELS: Record<AnalysisStep, string> = {
  1: 'Scraping reference accounts',
  2: 'Discovering competitors by niche',
  3: 'Scraping competitor profiles',
  4: 'Ranking by engagement and growth',
  5: 'Generating AI rationale',
}

export type AnalysisStatus =
  | 'idle'
  | 'chatting'
  | 'discovering'
  | 'confirming'
  | 'running'
  | 'clarifying'
  | 'done'
  | 'error'

export interface AnalysisParams {
  handles: string[]
  depth: 'standard' | 'deep'
  clientName: string
  /** Strategist-provided niche description. Optional — clarification step covers it when absent. */
  nicheContext: string
  /** Ranking breadth: 'precise' (default — strict niche guards) or 'broad' (recall-first). */
  mode?: 'precise' | 'broad'
}

/** Data held in the store during the clarification pause (between discovery and ranking). */
export interface PendingDiscovery {
  inputProfiles: NormalizedProfile[]
  candidateProfiles: NormalizedProfile[]
  clarificationQuestion: ClarificationQuestion
  /** Web-grounded niche briefing from the scrape's knowledge-seed call — forwarded to the ranking
   *  prompt so Phase 2 ranks with the same subniche context. Optional/absent on niche-less runs. */
  nicheBriefing?: string
}

export interface AnalysisState {
  status: AnalysisStatus
  currentStep: AnalysisStep
  params: AnalysisParams | null
  /** Conversation the run started in — results + errors route here via addMessageTo (2.1). */
  runConversationId: string | null

  /** Populated when status === 'clarifying'. Cleared on reset. */
  pendingDiscovery: PendingDiscovery | null
  /** Set by answerClarification(); read by analyzeMutation to inject into ranking prompt. */
  clarificationAnswer: string | null

  inputProfiles: NormalizedProfile[]
  /**
   * Profiles of the scraped competitor candidates (the accounts behind output.competitors).
   * Stored so competitor cards can render per-creator metrics (ER, followers) and the cross-
   * search corpus can harvest them — inputProfiles holds only the user's reference accounts.
   */
  candidateProfiles: NormalizedProfile[]
  competitors: CompetitorAnalysisResult[]
  niche: string
  summary: string
  error: string | null
  /** Total candidate accounts scraped by Apify (persisted from pendingDiscovery at setResults time). */
  candidateCount: number
  /** Live progress detail shown during the Apify wait (e.g. "Found 47 candidate accounts"). */
  stepProgressDetail: string
  /** True when the competitor pipeline found < 8 candidates (sparse niche indicator). */
  didExpand: boolean
  /**
   * True when these results came from the SCRAPE-BLOCKED web fallback (Apify down) rather than a
   * verified scrape. Drives the "web-sourced, unverified" banner + `~est`/`—` metric display, and
   * suppresses corpus harvest. Default false (the normal verified path).
   */
  unverified: boolean

  // Actions
  startAnalysis: (params: AnalysisParams, runConversationId?: string) => void
  setStep: (step: AnalysisStep) => void
  /** Transitions status to 'clarifying' and stores discovery data + generated question. */
  setClarification: (data: PendingDiscovery) => void
  /** Stores the user's clarification answer and transitions back to 'running'. */
  answerClarification: (answer: string) => void
  setResults: (output: AnalysisOutput, inputProfiles: NormalizedProfile[], candidateCount: number, candidateProfiles?: NormalizedProfile[], unverified?: boolean) => void
  setError: (message: string) => void
  setStepProgressDetail: (detail: string) => void
  setDidExpand: (value: boolean) => void
  reset: () => void

  // Conversational actions
  startChat: () => void
  setStatus: (status: AnalysisStatus) => void
}

const initialState = {
  status: 'idle' as AnalysisStatus,
  currentStep: 1 as AnalysisStep,
  params: null,
  runConversationId: null as string | null,
  pendingDiscovery: null,
  clarificationAnswer: null,
  inputProfiles: [],
  candidateProfiles: [] as NormalizedProfile[],
  competitors: [],
  niche: '',
  summary: '',
  error: null,
  candidateCount: 0,
  stepProgressDetail: '',
  didExpand: false,
  unverified: false,
}

export const useAnalysisStore = create<AnalysisState>()((set) => ({
  ...initialState,

  // Reset analysis-specific state for a new run. The chat transcript lives in
  // conversationsStore now, so this no longer needs to preserve it.
  startAnalysis: (params, runConversationId) =>
    set({ ...initialState, status: 'running', params, currentStep: 1, runConversationId: runConversationId ?? null }),

  setStep: (step) => set({ currentStep: step }),

  setClarification: (data) =>
    set({ status: 'clarifying', pendingDiscovery: data }),

  answerClarification: (answer) =>
    set({ status: 'running', clarificationAnswer: answer }),

  setResults: (output, inputProfiles, candidateCount, candidateProfiles = [], unverified = false) =>
    set({
      status: 'done',
      competitors: output.competitors,
      niche: output.niche,
      summary: output.summary,
      inputProfiles,
      candidateProfiles,
      candidateCount,
      unverified,
    }),

  setStepProgressDetail: (detail) => set({ stepProgressDetail: detail }),

  setDidExpand: (value) => set({ didExpand: value }),

  setError: (message) => set({ status: 'error', error: message }),

  reset: () => set(initialState),

  // Conversational actions
  startChat: () => set({ ...initialState, status: 'chatting' }),

  setStatus: (status) => set({ status }),
}))
