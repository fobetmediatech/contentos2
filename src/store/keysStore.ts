/**
 * Keys store — env-sourced API keys (no in-app entry, no persistence).
 *
 * Keys come exclusively from .env at build time (VITE_GEMINI_KEY, VITE_APIFY_KEY_1..10 or a
 * comma-separated VITE_APIFY_KEYS); the deep-reel serverless function reads GEMINI_API_KEY at
 * runtime. There is no Settings UI and this store is NOT persisted — every load reflects the
 * current env, so changing a key is a redeploy, not a localStorage edit. Apify cooldowns are
 * tracked separately by keyRotator (its own localStorage), so rotation still works at runtime.
 */

import { create } from 'zustand'
import { isReady, pickAvailableKey, getKeyExpiry } from '../lib/keyRotator'

// VITE_ env vars are inlined at build time. This Gemini key powers all browser-side Gemini
// calls; the serverless deep-reel function uses its own GEMINI_API_KEY (server-side env).
const ENV_GEMINI_KEY: string = import.meta.env.VITE_GEMINI_KEY ?? ''
// Numbered slots (back-compat) PLUS an optional comma-separated VITE_APIFY_KEYS for any number
// of keys — there's no fixed cap; keyRotator round-robins whatever it's given. Deduped.
const ENV_APIFY_KEYS: string[] = [
  ...new Set(
    [
      import.meta.env.VITE_APIFY_KEY_1,
      import.meta.env.VITE_APIFY_KEY_2,
      import.meta.env.VITE_APIFY_KEY_3,
      import.meta.env.VITE_APIFY_KEY_4,
      import.meta.env.VITE_APIFY_KEY_5,
      import.meta.env.VITE_APIFY_KEY_6,
      import.meta.env.VITE_APIFY_KEY_7,
      import.meta.env.VITE_APIFY_KEY_8,
      import.meta.env.VITE_APIFY_KEY_9,
      import.meta.env.VITE_APIFY_KEY_10,
      ...String(import.meta.env.VITE_APIFY_KEYS ?? '').split(','),
    ]
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter((k) => k.length > 0),
  ),
]

interface KeysState {
  geminiKey: string
  apifyKeys: string[]  // no fixed cap — keyRotator round-robins any count

  // Derived selectors
  isReady: () => boolean
  pickKey: () => string | null
  getKeyExpiry: (key: string) => number | null

  // Setters — internal/test seeding only (prod keys come from .env; there is no UI).
  setGeminiKey: (key: string) => void
  setApifyKeys: (keys: string[]) => void
  addApifyKey: (key: string) => void
  removeApifyKey: (index: number) => void
}

export const useKeysStore = create<KeysState>()((set, get) => ({
  geminiKey: ENV_GEMINI_KEY,
  apifyKeys: ENV_APIFY_KEYS,

  isReady: () => isReady(get().geminiKey, get().apifyKeys),
  pickKey: () => pickAvailableKey(get().apifyKeys),
  getKeyExpiry: (key: string) => getKeyExpiry(key),

  setGeminiKey: (key) => set({ geminiKey: key }),
  setApifyKeys: (keys) => set({ apifyKeys: keys }),
  addApifyKey: (key) => {
    const current = get().apifyKeys
    if (!current.includes(key)) set({ apifyKeys: [...current, key] })
  },
  removeApifyKey: (index) => {
    const current = [...get().apifyKeys]
    current.splice(index, 1)
    set({ apifyKeys: current })
  },
}))
