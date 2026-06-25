/**
 * Transcript store — one reel transcript at a time, tagged to the conversation
 * that triggered it. Completely independent from singleReelStore (no shared state).
 *
 * Not persisted across reloads (transcript results are lightweight and re-fetched
 * from IDB cache instantly if the user refreshes).
 */

import { create } from 'zustand'

export interface TranscriptSegment {
  start: number // seconds
  text: string
}

export interface TranscriptResult {
  transcript: string
  segments: TranscriptSegment[]
}

export type TranscriptStatus = 'idle' | 'running' | 'done' | 'failed'

interface TranscriptState {
  status: TranscriptStatus
  shortCode: string | null
  reelUrl: string | null
  conversationId: string | null
  progress: string
  result: TranscriptResult | null
  error: string | null
  startRun: (shortCode: string, reelUrl: string, conversationId: string | null) => void
  setProgress: (label: string) => void
  setResult: (result: TranscriptResult) => void
  setError: (msg: string) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as TranscriptStatus,
  shortCode: null as string | null,
  reelUrl: null as string | null,
  conversationId: null as string | null,
  progress: '',
  result: null as TranscriptResult | null,
  error: null as string | null,
}

export const useTranscriptStore = create<TranscriptState>()((set) => ({
  ...initialState,
  startRun: (shortCode, reelUrl, conversationId) =>
    set({ status: 'running', shortCode, reelUrl, conversationId, progress: 'Scraping reel…', result: null, error: null }),
  setProgress: (label) => set({ progress: label }),
  setResult: (result) => set({ status: 'done', progress: '', result, error: null }),
  setError: (msg) => set({ status: 'failed', progress: '', error: msg }),
  reset: () => set(initialState),
}))
