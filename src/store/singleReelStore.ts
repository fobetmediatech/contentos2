/**
 * Single-reel analysis store — one reel at a time, tagged to the conversation that
 * triggered it (so its result renders in the right chat). Persisted so a finished case
 * study survives reload; an interrupted mid-run is dropped on restore.
 *
 * Mirrors reelAnalysisStore's persist conventions (version + migrate + supabaseStorage).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabaseStorage } from './supabaseStorage'

// Keep in sync with api/_lib/singleReelPrompt.ts
// (app tsconfig.app.json includes only "src" — cannot import across the api/ boundary at build time)
export interface ReelSegment {
  start: number
  text: string
}

export interface ReelVideoAnalysis {
  duration_s: number | null
  aspect_ratio: string
  dominant_framing: string
  cuts_count: number | null
  text_overlay_density: string
  captions_present: boolean | null
  trending_audio_hint: string
  t0_frame: string
  visual_beats: Array<{ t_start: number | null; t_end: number | null; on_screen: string; function: string }>
  notable_moments: string[]
}

export interface ReelExtraction {
  transcript: string
  segments: ReelSegment[]
  videoAnalysis: ReelVideoAnalysis
}

export type SingleReelStatus = 'idle' | 'running' | 'done' | 'failed'

/** The serverless result: extraction (transcript/segments/videoAnalysis) + markdown case study. */
export interface SingleReelResult extends ReelExtraction {
  markdown: string
}

interface SingleReelState {
  status: SingleReelStatus
  shortCode: string | null
  reelUrl: string | null
  conversationId: string | null
  progress: string
  result: SingleReelResult | null
  error: string | null
  startRun: (shortCode: string, reelUrl: string, conversationId: string | null) => void
  setProgress: (label: string) => void
  setResult: (result: SingleReelResult) => void
  setError: (msg: string) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as SingleReelStatus,
  shortCode: null as string | null,
  reelUrl: null as string | null,
  conversationId: null as string | null,
  progress: '',
  result: null as SingleReelResult | null,
  error: null as string | null,
}

export const useSingleReelStore = create<SingleReelState>()(
  persist(
    (set) => ({
      ...initialState,
      startRun: (shortCode, reelUrl, conversationId) =>
        set({ status: 'running', shortCode, reelUrl, conversationId, progress: 'Scraping reel…', result: null, error: null }),
      setProgress: (label) => set({ progress: label }),
      setResult: (result) => set({ status: 'done', progress: '', result, error: null }),
      setError: (msg) => set({ status: 'failed', progress: '', error: msg }),
      reset: () => set(initialState),
    }),
    {
      name: 'contentos-single-reel',
      storage: supabaseStorage,
      skipHydration: true,
      partialize: (s) => ({
        status: s.status,
        shortCode: s.shortCode,
        reelUrl: s.reelUrl,
        conversationId: s.conversationId,
        result: s.result,
      }),
      version: 1,
      migrate: (state) => state,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SingleReelState>
        // Drop an interrupted mid-run: only restore a terminal 'done' state.
        if (p.status !== 'done' || !p.result) return current
        return { ...current, ...p, status: 'done' as SingleReelStatus, progress: '', error: null }
      },
    },
  ),
)
