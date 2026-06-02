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
import type { ParsedIntent } from '../ai/intentParser'

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

export interface ChatMessage {
  /** Stable unique id for React keys — monotonic, assigned by addMessage. */
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** Controls rendering: text = plain bubble, options = pill choices, error = red bubble */
  type?: 'text' | 'options' | 'error'
  /** Present when type === 'options' */
  options?: string[]
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
  /** Total candidate accounts scraped by Apify (persisted from pendingDiscovery at setResults time). */
  candidateCount: number
  /** Live progress detail shown during the Apify wait (e.g. "Found 47 candidate accounts"). */
  stepProgressDetail: string
  /** True when the competitor pipeline found < 8 candidates (sparse niche indicator). */
  didExpand: boolean

  /** Conversation history for the chat UI. Capped at 50 messages to prevent unbounded growth. */
  conversationMessages: ChatMessage[]
  /** Populated after successful seed discovery; read by confirmSeeds() in useConversation. */
  discoveredSeeds: string[]
  /** Populated after parseIntent() succeeds; read by confirmSeeds() to build analyze() params. */
  parsedIntent: ParsedIntent | null

  // Actions
  startAnalysis: (params: AnalysisParams) => void
  setStep: (step: AnalysisStep) => void
  /** Transitions status to 'clarifying' and stores discovery data + generated question. */
  setClarification: (data: PendingDiscovery) => void
  /** Stores the user's clarification answer and transitions back to 'running'. */
  answerClarification: (answer: string) => void
  setResults: (output: AnalysisOutput, inputProfiles: NormalizedProfile[], candidateCount: number) => void
  setError: (message: string) => void
  setStepProgressDetail: (detail: string) => void
  setDidExpand: (value: boolean) => void
  reset: () => void

  // Conversational actions
  startChat: () => void
  setStatus: (status: AnalysisStatus) => void
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => void
  setDiscoveredSeeds: (seeds: string[]) => void
  setParsedIntent: (intent: ParsedIntent | null) => void
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
  candidateCount: 0,
  stepProgressDetail: '',
  didExpand: false,
  // Conversational fields — T22: included in initialState for proper reset()
  conversationMessages: [] as ChatMessage[],
  discoveredSeeds: [] as string[],
  parsedIntent: null,
}

// Monotonic message-id sequence for stable React keys (M13). The old
// `${timestamp}-${index}` key collided on same-millisecond messages and churned when
// the 50-message slice slid. Module-scope so ids stay unique across store resets.
let _msgSeq = 0

export const useAnalysisStore = create<AnalysisState>()((set) => ({
  ...initialState,

  startAnalysis: (params) =>
    set({ ...initialState, status: 'running', params, currentStep: 1 }),

  setStep: (step) => set({ currentStep: step }),

  setClarification: (data) =>
    set({ status: 'clarifying', pendingDiscovery: data }),

  answerClarification: (answer) =>
    set({ status: 'running', clarificationAnswer: answer }),

  setResults: (output, inputProfiles, candidateCount) =>
    set({
      status: 'done',
      competitors: output.competitors,
      niche: output.niche,
      summary: output.summary,
      inputProfiles,
      candidateCount,
    }),

  setStepProgressDetail: (detail) => set({ stepProgressDetail: detail }),

  setDidExpand: (value) => set({ didExpand: value }),

  setError: (message) => set({ status: 'error', error: message }),

  reset: () => set(initialState),

  // Conversational actions
  startChat: () => set({ ...initialState, status: 'chatting' }),

  setStatus: (status) => set({ status }),

  addMessage: (message) =>
    set((state) => ({
      conversationMessages: [
        ...state.conversationMessages,
        { ...message, id: message.id ?? `msg-${_msgSeq++}`, timestamp: message.timestamp ?? Date.now() },
      ].slice(-50),  // cap at 50 messages
    })),

  setDiscoveredSeeds: (seeds) => set({ discoveredSeeds: seeds }),

  setParsedIntent: (intent) => set({ parsedIntent: intent }),
}))
