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

// Types moved to src/domain/reel.ts (Task 6). Re-exported here for backward compat
// until Task 11 removes this store. DO NOT import directly from here in new code.
export type { ReelSegment, ReelVideoAnalysis, ReelExtraction, SingleReelResult } from '../domain/reel'
import type { SingleReelResult } from '../domain/reel'

export type SingleReelStatus = 'idle' | 'running' | 'done' | 'failed'

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
