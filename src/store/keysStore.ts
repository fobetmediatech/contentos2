/**
 * Keys store — Phase 1: Gemini and Apify keys now live on the server proxy.
 *
 * After Phase 1 (api/gemini.ts + api/apify.ts), all third-party API keys are held in
 * server-side process.env (GEMINI_API_KEY, APIFY_KEY_1..10). This store no longer
 * reads VITE_ key env vars. The empty arrays are kept for call-site compatibility;
 * callers pass them to geminiGenerate/startRun where they are ignored by the proxy.
 * isReady() always returns true — if the server is misconfigured, errors surface as
 * pipeline errors, not as a blocked UI.
 */

import { create } from 'zustand'
import { pickAvailableKey, getKeyExpiry } from '../lib/keyRotator'

// Phase 1: Gemini and Apify keys now live on the server proxy (api/gemini.ts, api/apify.ts).
// These empty arrays are kept for call-site compatibility — callers still pass them to
// geminiGenerate/startRun where they are ignored by the proxy transport.
// isReady() returns true unconditionally; server misconfiguration surfaces as pipeline errors.
const ENV_GEMINI_KEYS: string[] = []
const ENV_GEMINI_KEY = ''
const ENV_APIFY_KEYS: string[] = []

interface KeysState {
  geminiKey: string    // first key — back-compat for single-key readers (isReady, fallbacks)
  geminiKeys: string[] // full pool — geminiKeyRotator round-robins any count
  apifyKeys: string[]  // no fixed cap — keyRotator round-robins any count

  // Derived selectors
  isReady: () => boolean
  pickKey: () => string | null
  getKeyExpiry: (key: string) => number | null

  // Setters — internal/test seeding only (prod keys come from .env; there is no UI).
  setGeminiKey: (key: string) => void
  setGeminiKeys: (keys: string[]) => void
  setApifyKeys: (keys: string[]) => void
  addApifyKey: (key: string) => void
  removeApifyKey: (index: number) => void
}

export const useKeysStore = create<KeysState>()((set, get) => ({
  geminiKey: ENV_GEMINI_KEY,
  geminiKeys: ENV_GEMINI_KEYS,
  apifyKeys: ENV_APIFY_KEYS,

  isReady: () => true,  // server holds the keys; misconfiguration surfaces as a pipeline error
  pickKey: () => pickAvailableKey(get().apifyKeys),
  getKeyExpiry: (key: string) => getKeyExpiry(key),

  setGeminiKey: (key) => set({ geminiKey: key, geminiKeys: key.trim() ? [key.trim()] : [] }),
  setGeminiKeys: (keys) => set({ geminiKeys: keys, geminiKey: keys[0] ?? '' }),
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
