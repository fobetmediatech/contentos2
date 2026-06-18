/**
 * Zustand store for tracking dashboard UI state.
 * Tracks which accounts are currently fetching and any in-flight errors.
 * Actual data (accounts, snapshots) lives in Supabase — read via TanStack Query.
 */
import { create } from 'zustand'
import type { FetchPhase } from '../lib/trackingClient'

interface AccountFetchState {
  phase: FetchPhase
  error?: string
}

interface TrackingState {
  /** Per-account fetch progress: username → current phase */
  fetching: Record<string, AccountFetchState>

  setFetching: (username: string, state: AccountFetchState) => void
  clearFetching: (username: string) => void
  isFetching: (username: string) => boolean
}

export const useTrackingStore = create<TrackingState>((set, get) => ({
  fetching: {},

  setFetching(username, state) {
    set((s) => ({ fetching: { ...s.fetching, [username]: state } }))
  },

  clearFetching(username) {
    set((s) => {
      const next = { ...s.fetching }
      delete next[username]
      return { fetching: next }
    })
  },

  isFetching(username) {
    const s = get().fetching[username]
    return !!s && s.phase !== 'done' && s.phase !== 'error'
  },
}))
