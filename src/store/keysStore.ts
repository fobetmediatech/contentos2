/**
 * Keys store — Zustand with persistence and cross-tab sync.
 *
 * UC1: Cooldown timestamps stored as epoch milliseconds (numbers, not Date).
 * UC1: storage event listener syncs state across browser tabs.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isReady, pickAvailableKey, getKeyExpiry } from '../lib/keyRotator'

// VITE_ env vars are baked in at build time — acceptable for internal team deployments.
// Team members who manually enter keys in Settings override these; they're just defaults.
const ENV_GEMINI_KEY: string = import.meta.env.VITE_GEMINI_KEY ?? ''
const ENV_APIFY_KEYS: string[] = [
  import.meta.env.VITE_APIFY_KEY_1,
  import.meta.env.VITE_APIFY_KEY_2,
  import.meta.env.VITE_APIFY_KEY_3,
  import.meta.env.VITE_APIFY_KEY_4,
  import.meta.env.VITE_APIFY_KEY_5,
].filter((k): k is string => typeof k === 'string' && k.trim().length > 0)

interface KeysState {
  geminiKey: string
  apifyKeys: string[]  // up to 10 keys

  // Derived selectors
  isReady: () => boolean
  pickKey: () => string | null
  getKeyExpiry: (key: string) => number | null

  // Setters
  setGeminiKey: (key: string) => void
  setApifyKeys: (keys: string[]) => void
  addApifyKey: (key: string) => void
  removeApifyKey: (index: number) => void
}

export const useKeysStore = create<KeysState>()(
  persist(
    (set, get) => ({
      geminiKey: ENV_GEMINI_KEY,
      apifyKeys: ENV_APIFY_KEYS,

      isReady: () => isReady(get().geminiKey, get().apifyKeys),
      pickKey: () => pickAvailableKey(get().apifyKeys),
      getKeyExpiry: (key: string) => getKeyExpiry(key),

      setGeminiKey: (key) => set({ geminiKey: key }),
      setApifyKeys: (keys) => set({ apifyKeys: keys.slice(0, 10) }),
      addApifyKey: (key) => {
        const current = get().apifyKeys
        if (current.length >= 10) return
        if (!current.includes(key)) set({ apifyKeys: [...current, key] })
      },
      removeApifyKey: (index) => {
        const current = [...get().apifyKeys]
        current.splice(index, 1)
        set({ apifyKeys: current })
      },
    }),
    {
      name: 'keys-store',
      // Only persist the key values, not derived functions
      partialize: (state) => ({
        geminiKey: state.geminiKey,
        apifyKeys: state.apifyKeys,
      }),
    },
  ),
)

// Cross-tab sync via storage events (UC1)
// When another tab writes to localStorage, re-read and update this tab's state
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'keys-store') {
      try {
        const newState = JSON.parse(event.newValue ?? '{}')
        const incoming = newState?.state
        if (!incoming || typeof incoming !== 'object') return
        // H9: patch ONLY the fields actually present in the payload. A partial or
        // mid-migration write from another tab must never wipe this tab's keys —
        // the old `?? '' / ?? []` reset the user to "logged out" on any odd write.
        const patch: Partial<Pick<KeysState, 'geminiKey' | 'apifyKeys'>> = {}
        if (typeof incoming.geminiKey === 'string') patch.geminiKey = incoming.geminiKey
        if (Array.isArray(incoming.apifyKeys)) patch.apifyKeys = incoming.apifyKeys
        if (Object.keys(patch).length > 0) useKeysStore.setState(patch)
      } catch {
        // Ignore malformed storage events
      }
    }
  })
}
