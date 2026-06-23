/**
 * Reel analysis state store — tracks per-creator reel scraping and AI analysis,
 * plus a cross-creator synthesis output.
 *
 * Mirrors the discoveryStore pattern for store structure and reset behaviour.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabaseStorage } from './supabaseStorage'
import { isCleanReelRun } from './reelPersist'
import type { DeepReelAnalysis, DeepNicheReport } from '../ai/prompts/deepReelAnalysis'
import type { SingleReelResult } from './singleReelStore'
import type { CreatorHookSummary } from '../ai/prompts/creatorHookSummary'

// ----- Creator status -----

export type CreatorStatus = 'idle' | 'scraping' | 'analyzing' | 'done' | 'no-reels' | 'failed'

// ----- Deep (multimodal) per-reel status -----
// Phase-1 reel-intelligence: the enrichment runs per reel, so each reel carries
// its own lifecycle independent of the creator-level status (R2: partial results
// never block on one failure).
export type DeepReelStatus = 'pending' | 'fetching' | 'analyzing' | 'done' | 'failed' | 'skipped'

// ----- Case-study (HookMap deep analysis) per-reel status -----
// Profile HookMap: single-reel case-study analysis for profile-level deep reports
export type ReelCaseStatus = 'pending' | 'analyzing' | 'done' | 'skipped' | 'failed'

/** A DeepReelAnalysis with the client-computed commentsLikesRatio attached. */
export interface StoredDeepReelAnalysis extends DeepReelAnalysis {
  commentsLikesRatio: number
}

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
  openingLine?: string        // the verbatim/implied hook line that stops the scroll (HookMap-style)
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
  analyses: Record<string, ReelAnalysis>  // keyed by shortCode (quick caption-only path)
  /** Full spoken transcripts per reel (keyed by shortCode), produced by the single-reel
   *  analyzer enrichment pass. Optional — only populated once transcription completes. */
  transcripts?: Record<string, string>
  caseStudies?: Record<string, SingleReelResult>       // keyed by shortCode (HookMap full result)
  caseStudyStatus?: Record<string, ReelCaseStatus>     // keyed by shortCode (progressive per reel)
  hookSummary?: CreatorHookSummary                      // creator-level summary from case studies (profile HookMap)
  error?: string
  // ----- Deep (multimodal) enrichment — Phase-1 reel intelligence -----
  // Optional: only the deep-report run populates these; the quick path leaves
  // them undefined. Both reset wholesale (reset() sets creatorStates: {}).
  deepStatus?: Record<string, DeepReelStatus>          // keyed by shortCode
  deepAnalyses?: Record<string, StoredDeepReelAnalysis> // keyed by shortCode
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
  /** Conversation the current run belongs to — so its result snapshots into the RIGHT chat,
   *  and the live block only renders in that conversation (no cross-conversation mismatch). */
  reelConversationId: string | null
  creatorStates: Record<string, CreatorAnalysisState>
  synthesisStatus: 'idle' | 'running' | 'done' | 'failed'
  synthesis: SynthesisOutput | null
  synthesisError: string | null
  // Cross-profile deep niche report (Phase 2) — produced after a deep run finishes.
  deepReport: DeepNicheReport | null
  // 'unavailable' = the deep-analysis serverless function isn't deployed (e.g. plain `vite dev`)
  deepReportStatus: 'idle' | 'running' | 'done' | 'failed' | 'unavailable'
  // actions
  setSelectedHandles: (handles: string[]) => void
  setActiveHandles: (handles: string[]) => void
  setReelConversationId: (id: string | null) => void
  setCreatorState: (handle: string, partial: Partial<CreatorAnalysisState>) => void
  /** Merge a single reel's deep status and/or analysis into a creator's deep maps. */
  setDeepReel: (
    handle: string,
    shortCode: string,
    partial: { status?: DeepReelStatus; analysis?: StoredDeepReelAnalysis },
  ) => void
  /** Merge a single reel's case-study status and/or result into a creator's case-study maps. */
  setReelCaseStudy: (
    handle: string,
    shortCode: string,
    partial: { status?: ReelCaseStatus; result?: SingleReelResult },
  ) => void
  /** Merge a creator-level hook summary into a creator's state. */
  setHookSummary: (handle: string, summary: CreatorHookSummary) => void
  setSynthesis: (output: SynthesisOutput) => void
  setSynthesisStatus: (status: ReelAnalysisState['synthesisStatus']) => void
  setSynthesisError: (msg: string) => void
  setDeepReport: (report: DeepNicheReport) => void
  setDeepReportStatus: (status: ReelAnalysisState['deepReportStatus']) => void
  reset: () => void
}

// ----- Initial state -----

const initialState = {
  selectedHandles: [] as string[],
  activeHandles: [] as string[],
  reelConversationId: null as string | null,
  creatorStates: {} as Record<string, CreatorAnalysisState>,
  synthesisStatus: 'idle' as ReelAnalysisState['synthesisStatus'],
  synthesis: null as SynthesisOutput | null,
  synthesisError: null as string | null,
  // Phase 2: included in initialState so reset() clears them (zustand-initialstate learning).
  deepReport: null as DeepNicheReport | null,
  deepReportStatus: 'idle' as ReelAnalysisState['deepReportStatus'],
}

// ----- Store -----

export const useReelAnalysisStore = create<ReelAnalysisState>()(persist((set) => ({
  ...initialState,

  setSelectedHandles: (handles) => set({ selectedHandles: handles }),

  setReelConversationId: (id) => set({ reelConversationId: id }),

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

  setDeepReel: (handle, shortCode, partial) =>
    set((prev) => {
      const creator = prev.creatorStates[handle]
      if (!creator) return {} // never create a creator from a deep update — orchestrator seeds it first
      const deepStatus = { ...creator.deepStatus }
      const deepAnalyses = { ...creator.deepAnalyses }
      if (partial.status) deepStatus[shortCode] = partial.status
      if (partial.analysis) deepAnalyses[shortCode] = partial.analysis
      return {
        creatorStates: {
          ...prev.creatorStates,
          [handle]: { ...creator, deepStatus, deepAnalyses },
        },
      }
    }),

  setReelCaseStudy: (handle, shortCode, partial) =>
    set((prev) => {
      const creator = prev.creatorStates[handle]
      if (!creator) return {} // never create a creator from a case-study update — pipeline seeds it
      const caseStudyStatus = { ...creator.caseStudyStatus }
      const caseStudies = { ...creator.caseStudies }
      if (partial.status) caseStudyStatus[shortCode] = partial.status
      if (partial.result) caseStudies[shortCode] = partial.result
      return {
        creatorStates: {
          ...prev.creatorStates,
          [handle]: { ...creator, caseStudyStatus, caseStudies },
        },
      }
    }),

  setHookSummary: (handle, summary) =>
    set((prev) => {
      const creator = prev.creatorStates[handle]
      if (!creator) return {} // never create a creator from a hook summary update — pipeline seeds it
      return {
        creatorStates: {
          ...prev.creatorStates,
          [handle]: { ...creator, hookSummary: summary },
        },
      }
    }),

  setSynthesis: (output) => set({ synthesis: output, synthesisStatus: 'done' }),

  setSynthesisStatus: (status) => set({ synthesisStatus: status }),

  setSynthesisError: (msg) => set({ synthesisError: msg, synthesisStatus: 'failed' }),

  setDeepReport: (report) => set({ deepReport: report, deepReportStatus: 'done' }),

  setDeepReportStatus: (status) => set({ deepReportStatus: status }),

  reset: () => set(initialState),
}), {
  // Persist a finished reel analysis so it survives a reload (it used to vanish — the store
  // reset to empty on refresh). Only the result data + terminal status are persisted; the
  // merge guard drops an interrupted mid-run so the UI never restores onto stuck spinners.
  name: 'contentos-reels',
  storage: supabaseStorage,
  skipHydration: true,
  partialize: (s) => ({
    activeHandles: s.activeHandles,
    reelConversationId: s.reelConversationId,
    creatorStates: s.creatorStates,
    synthesis: s.synthesis,
    synthesisStatus: s.synthesisStatus,
    deepReport: s.deepReport,
    deepReportStatus: s.deepReportStatus,
  }),
  // v3: added optional CreatorAnalysisState.caseStudies and caseStudyStatus (profile HookMap case-study).
  // v2: added optional CreatorAnalysisState.transcripts (single-reel-analyzer enrichment).
  // Purely additive — old persisted runs deserialize cleanly with new fields undefined.
  version: 3,
  migrate: (state) => state,
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<ReelAnalysisState>
    const creatorStates = (p.creatorStates ?? {}) as Record<string, { status: string }>
    if (!isCleanReelRun({ synthesisStatus: p.synthesisStatus ?? 'idle', deepReportStatus: p.deepReportStatus ?? 'idle', creatorStates })) {
      return current // interrupted run → discard, come back to a clean slate
    }
    // 2.11: clamp any non-terminal status to 'failed' so a reload never restores a
    // forever-spinner (e.g. synthesisStatus='done' + deepReportStatus='running' passes
    // isCleanReelRun but would restore a stuck deep-report spinner).
    const SYNTH_TERMINAL = new Set(['done', 'failed', 'idle'])
    const DEEP_TERMINAL = new Set(['done', 'failed', 'unavailable', 'idle'])
    const synthesisStatus = SYNTH_TERMINAL.has(p.synthesisStatus ?? '') ? (p.synthesisStatus as ReelAnalysisState['synthesisStatus']) : 'failed'
    const deepReportStatus = DEEP_TERMINAL.has(p.deepReportStatus ?? '') ? (p.deepReportStatus as ReelAnalysisState['deepReportStatus']) : 'failed'
    return { ...current, ...p, synthesisStatus: synthesisStatus ?? 'idle', deepReportStatus: deepReportStatus ?? 'idle' }
  },
}))
