/**
 * Content Strategizing store — holds the onboarding brief (form draft) and the last generated
 * strategy document. Brief + result are persisted (survive reload); run status is transient.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safePersistStorage } from './persistStorage'
import { EMPTY_BRIEF, type StrategyBrief, type StrategyResult } from '../domain/strategy'

export type StrategyStatus = 'idle' | 'running' | 'error' | 'done'

interface StrategyState {
  brief: StrategyBrief
  status: StrategyStatus
  step: string
  error: string | null
  result: StrategyResult | null
  setBrief: (b: StrategyBrief) => void
  start: () => void
  setStep: (s: string) => void
  setResult: (r: StrategyResult) => void
  setError: (e: string) => void
  reset: () => void
}

export const useStrategyStore = create<StrategyState>()(
  persist(
    (set) => ({
      brief: EMPTY_BRIEF,
      status: 'idle',
      step: '',
      error: null,
      result: null,
      setBrief: (brief) => set({ brief }),
      start: () => set({ status: 'running', step: 'Starting…', error: null }),
      setStep: (step) => set({ step }),
      setResult: (result) => set({ result, status: 'done', step: '' }),
      setError: (error) => set({ error, status: 'error', step: '' }),
      reset: () => set({ status: 'idle', step: '', error: null }),
    }),
    {
      name: 'content-strategy',
      version: 3,
      storage: safePersistStorage,
      // Persist only the brief + last result; transient run state is not persisted.
      partialize: (s) => ({ brief: s.brief, result: s.result }),
      // v2 added brief.theme — spread EMPTY_BRIEF first so any new field is backfilled on older
      // persisted state and the form/deck never read undefined. (A now-removed brief.imageKeyword
      // may linger on old persisted state; it's unused and harmless.)
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<StrategyState>
        return {
          ...s,
          brief: {
            ...EMPTY_BRIEF,
            ...(s.brief ?? {}),
            theme: { ...EMPTY_BRIEF.theme, ...(s.brief?.theme ?? {}) },
          },
        } as StrategyState
      },
    },
  ),
)
