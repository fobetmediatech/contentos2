/**
 * Reel analysis state store — tracks per-creator reel scraping and AI analysis,
 * plus a cross-creator synthesis output.
 *
 * Mirrors the discoveryStore pattern for store structure and reset behaviour.
 */

import { create } from 'zustand'

// ----- Creator status -----

export type CreatorStatus = 'idle' | 'scraping' | 'analyzing' | 'done' | 'no-reels' | 'failed'

// ----- Data types -----

export interface ReelData {
  shortCode: string
  url: string
  displayUrl: string       // thumbnail from Apify 'displayUrl' field
  videoViewCount: number
  likesCount: number
  commentsCount: number
  videoDuration: number
  caption: string
  hashtags: string[]
  musicInfo?: unknown
}

export interface ReelAnalysis {
  hookArchetype: string
  secondaryArchetype?: string
  commentsLikesRatio: number  // computed client-side (commentsCount / Math.max(1, likesCount))
  retentionMechanism: string
  psychologyTrigger: string
  replicationTemplate: string
  lowConfidenceNote?: string  // present when visual-shock or demo-first
}

export interface CreatorAnalysisState {
  handle: string
  status: CreatorStatus
  reels: ReelData[]
  analyses: Record<string, ReelAnalysis>  // keyed by shortCode
  error?: string
}

export interface SynthesisOutput {
  topPatterns: Array<{ archetype: string; count: number; example: string }>
  benchmarks: { medianViews: number; likesViewsRatio: number; commentsLikesRatio: number }
  replicateTips: string[]   // 3 items
  avoidTips: string[]       // 2 items
}

export interface PerCreatorSummary {
  handle: string
  dominantArchetype: string
  secondDominantArchetype?: string
  topReelViews: number
  medianViews: number
  commentsLikesRatios: number[]
  reelCount: number
}

// ----- Store interface -----

interface ReelAnalysisState {
  selectedHandles: string[]
  /** Handles in the current analysis run — the single source of truth for which
   *  creators are being / have been analyzed. Set by startAnalysis, cleared on reset.
   *  Both the inline ChatPage surface and NL-routed runs read this. */
  activeHandles: string[]
  creatorStates: Record<string, CreatorAnalysisState>
  synthesisStatus: 'idle' | 'running' | 'done' | 'failed'
  synthesis: SynthesisOutput | null
  synthesisError: string | null
  // actions
  setSelectedHandles: (handles: string[]) => void
  setActiveHandles: (handles: string[]) => void
  setCreatorState: (handle: string, partial: Partial<CreatorAnalysisState>) => void
  setSynthesis: (output: SynthesisOutput) => void
  setSynthesisStatus: (status: ReelAnalysisState['synthesisStatus']) => void
  setSynthesisError: (msg: string) => void
  reset: () => void
}

// ----- Initial state -----

const initialState = {
  selectedHandles: [] as string[],
  activeHandles: [] as string[],
  creatorStates: {} as Record<string, CreatorAnalysisState>,
  synthesisStatus: 'idle' as ReelAnalysisState['synthesisStatus'],
  synthesis: null as SynthesisOutput | null,
  synthesisError: null as string | null,
}

// ----- Store -----

export const useReelAnalysisStore = create<ReelAnalysisState>()((set) => ({
  ...initialState,

  setSelectedHandles: (handles) => set({ selectedHandles: handles }),

  setActiveHandles: (handles) => set({ activeHandles: handles }),

  setCreatorState: (handle, partial) =>
    set((prev) => ({
      creatorStates: {
        ...prev.creatorStates,
        [handle]: {
          ...prev.creatorStates[handle],
          ...partial,
        },
      },
    })),

  setSynthesis: (output) => set({ synthesis: output, synthesisStatus: 'done' }),

  setSynthesisStatus: (status) => set({ synthesisStatus: status }),

  setSynthesisError: (msg) => set({ synthesisError: msg, synthesisStatus: 'failed' }),

  reset: () => set(initialState),
}))
