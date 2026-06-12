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
import type { CompetitorAnalysisResult, DiscoveryResult, AnalysisOutput, ClarificationQuestion } from '../ai/prompts'
import type { ParsedIntent } from '../ai/intentParser'
// Type-only imports (erased at runtime — no cycle) for the reel result snapshot.
import type { CreatorAnalysisState, SynthesisOutput } from './reelAnalysisStore'
import type { DeepNicheReport } from '../ai/prompts/deepReelAnalysis'

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
}

/** Data held in the store during the clarification pause (between discovery and ranking). */
export interface PendingDiscovery {
  inputProfiles: NormalizedProfile[]
  candidateProfiles: NormalizedProfile[]
  clarificationQuestion: ClarificationQuestion
}

/**
 * Phase 2 (results-as-messages): a completed pipeline result, snapshotted INTO the
 * conversation as a message so it persists across reloads and interleaves with the chat
 * (multiple searches each keep their results in place) instead of rendering from transient
 * store status. Stage 1 = competitor, stage 2 = discovery; reel still positions a live marker.
 */
export type CompetitorResultPayload = {
  kind: 'competitor'
  competitors: CompetitorAnalysisResult[]
  summary: string
  niche: string
  profiles: NormalizedProfile[]
  didExpand: boolean
}
export type DiscoveryResultPayload = {
  kind: 'discovery'
  results: DiscoveryResult[]
  city: string
  profiles: NormalizedProfile[]
  didExpand: boolean
  locationRelaxed: boolean
}
/**
 * A finished reel/hook run, snapshotted into the conversation it ran in (Phase 2 parity with
 * competitor/discovery). Replaces the old global-store + live-marker approach, which showed the
 * wrong run after switching conversations. `creatorStates` is trimmed (thumbnails + deep maps
 * dropped); the deep report re-runs on demand via the (independent) startDeepReport(handles).
 */
export type ReelResultPayload = {
  kind: 'reel'
  handles: string[]
  creatorStates: Record<string, CreatorAnalysisState>
  synthesis: SynthesisOutput | null
  deepReport: DeepNicheReport | null
}
export type ResultPayload = CompetitorResultPayload | DiscoveryResultPayload | ReelResultPayload

export interface ChatMessage {
  /** Stable unique id for React keys — monotonic, assigned by addMessage. */
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /**
   * Controls rendering: text = plain bubble, options = pill choices, error = red bubble,
   * result = inline result cards, reel = position marker for the (live) reel-analysis block.
   */
  type?: 'text' | 'options' | 'error' | 'result' | 'reel'
  /** Present when type === 'options' */
  options?: string[]
  /** Present when type === 'result' — the snapshotted pipeline result rendered inline. */
  result?: ResultPayload
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

  // NOTE: the chat transcript moved to conversationsStore (multi-conversation history) — this
  // store now holds ONLY analysis state. The active conversation's messages live there.
  /** Populated after successful seed discovery; read by confirmSeeds() in useConversation. */
  discoveredSeeds: string[]
  /** Populated after parseIntent() succeeds; read by confirmSeeds() to build analyze() params. */
  parsedIntent: ParsedIntent | null

  // Actions
  startAnalysis: (params: AnalysisParams, runConversationId?: string) => void
  setStep: (step: AnalysisStep) => void
  /** Transitions status to 'clarifying' and stores discovery data + generated question. */
  setClarification: (data: PendingDiscovery) => void
  /** Stores the user's clarification answer and transitions back to 'running'. */
  answerClarification: (answer: string) => void
  setResults: (output: AnalysisOutput, inputProfiles: NormalizedProfile[], candidateCount: number, candidateProfiles?: NormalizedProfile[]) => void
  setError: (message: string) => void
  setStepProgressDetail: (detail: string) => void
  setDidExpand: (value: boolean) => void
  reset: () => void

  // Conversational actions
  startChat: () => void
  setStatus: (status: AnalysisStatus) => void
  setDiscoveredSeeds: (seeds: string[]) => void
  setParsedIntent: (intent: ParsedIntent | null) => void
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
  // Conversational fields — T22: included in initialState for proper reset()
  discoveredSeeds: [] as string[],
  parsedIntent: null,
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

  setResults: (output, inputProfiles, candidateCount, candidateProfiles = []) =>
    set({
      status: 'done',
      competitors: output.competitors,
      niche: output.niche,
      summary: output.summary,
      inputProfiles,
      candidateProfiles,
      candidateCount,
    }),

  setStepProgressDetail: (detail) => set({ stepProgressDetail: detail }),

  setDidExpand: (value) => set({ didExpand: value }),

  setError: (message) => set({ status: 'error', error: message }),

  reset: () => set(initialState),

  // Conversational actions
  startChat: () => set({ ...initialState, status: 'chatting' }),

  setStatus: (status) => set({ status }),

  setDiscoveredSeeds: (seeds) => set({ discoveredSeeds: seeds }),

  setParsedIntent: (intent) => set({ parsedIntent: intent }),
}))
