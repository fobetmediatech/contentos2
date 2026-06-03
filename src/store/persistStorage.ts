/**
 * A localStorage-backed storage for zustand `persist` that NEVER throws.
 *
 * Some environments expose a `localStorage` whose methods aren't real functions (certain
 * jsdom/test setups), or none at all (Node). An unguarded persist store calls
 * localStorage.getItem during hydration on import — if that throws, it takes down every
 * test in the file, not just the store's own. This wrapper guards every call and falls
 * back to an in-memory map so importing a persisted store is always safe.
 */

import { createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'

const mem = new Map<string, string>()

function usable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
  } catch {
    return false
  }
}

const backend: StateStorage = {
  getItem: (key) => {
    try {
      return usable() ? localStorage.getItem(key) : (mem.get(key) ?? null)
    } catch {
      return mem.get(key) ?? null
    }
  },
  setItem: (key, value) => {
    try {
      if (usable()) localStorage.setItem(key, value)
      else mem.set(key, value)
    } catch {
      mem.set(key, value)
    }
  },
  removeItem: (key) => {
    try {
      if (usable()) localStorage.removeItem(key)
      else mem.delete(key)
    } catch {
      mem.delete(key)
    }
  },
}

export const safePersistStorage = createJSONStorage(() => backend)
