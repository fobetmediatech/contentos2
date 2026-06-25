// src/store/repurposeStore.ts
/**
 * Repurpose Reel run state — transient per-run state for the repurpose pipeline.
 *
 * Mirrors reelAnalysisStore: persisted via supabaseStorage, skipHydration, a `merge` guard
 * that drops interrupted runs on restore (so a reload during a run comes back clean). The
 * finished result is snapshotted into the conversation by ChatPage; this store only drives
 * the in-flight progress block.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabaseStorage } from './supabaseStorage'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

export type RepurposeStatus =
  | 'idle' | 'building-profile' | 'analyzing-source' | 'rewriting' | 'done' | 'error'

/** True when a persisted run is safe to restore (terminal), false mid-flight. */
export function isCleanRepurposeRun(s: { status: string }): boolean {
  return s.status === 'done' || s.status === 'error' || s.status === 'idle'
}

interface RepurposeState {
  status: RepurposeStatus
  conversationId: string | null
  sourceReelUrl: string
  clientHandle: string
  voiceProfile: VoiceProfile | null
  rewrite: ReelRewriteResult | null
  error: string | null
  start: (conversationId: string, sourceReelUrl: string, clientHandle: string) => void
  setStatus: (status: RepurposeStatus) => void
  setVoiceProfile: (profile: VoiceProfile) => void
  setRewrite: (rewrite: ReelRewriteResult) => void
  setError: (message: string) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as RepurposeStatus,
  conversationId: null as string | null,
  sourceReelUrl: '',
  clientHandle: '',
  voiceProfile: null as VoiceProfile | null,
  rewrite: null as ReelRewriteResult | null,
  error: null as string | null,
}

export const useRepurposeStore = create<RepurposeState>()(persist((set) => ({
  ...initialState,
  start: (conversationId, sourceReelUrl, clientHandle) =>
    set({ ...initialState, status: 'building-profile', conversationId, sourceReelUrl, clientHandle }),
  setStatus: (status) => set({ status }),
  setVoiceProfile: (voiceProfile) => set({ voiceProfile }),
  setRewrite: (rewrite) => set({ rewrite }),
  setError: (message) => set({ status: 'error', error: message }),
  reset: () => set(initialState),
}), {
  name: 'contentos-repurpose',
  storage: supabaseStorage,
  skipHydration: true,
  partialize: (s) => ({
    status: s.status,
    conversationId: s.conversationId,
    sourceReelUrl: s.sourceReelUrl,
    clientHandle: s.clientHandle,
    voiceProfile: s.voiceProfile,
    rewrite: s.rewrite,
  }),
  version: 1,
  migrate: (state) => state,
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<RepurposeState>
    if (!isCleanRepurposeRun({ status: p.status ?? 'idle' })) return current // interrupted → clean slate
    return { ...current, ...p }
  },
}))
