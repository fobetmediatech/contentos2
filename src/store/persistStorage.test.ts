/**
 * Tests for safePersistStorage — the import-safe localStorage wrapper under every persisted
 * store. The contract: it NEVER throws (even when localStorage is missing or its methods throw)
 * and falls back to an in-memory map so a hostile/missing localStorage can't take down a store.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { safePersistStorage } from './persistStorage'
import type { StorageValue } from 'zustand/middleware'

const store = safePersistStorage!
const val = (a: number): StorageValue<{ a: number }> => ({ state: { a }, version: 0 })

afterEach(() => vi.unstubAllGlobals())

describe('safePersistStorage', () => {
  it('falls back to in-memory when localStorage is missing (and never throws)', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => store.setItem('k1', val(1))).not.toThrow()
    expect(store.getItem('k1')).toEqual(val(1)) // round-trips via the in-memory map
    store.removeItem('k1')
    expect(store.getItem('k1')).toBeNull()
  })

  it('never throws and falls back to memory when localStorage methods throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => store.setItem('k2', val(2))).not.toThrow()
    expect(() => store.getItem('k2')).not.toThrow()
    expect(store.getItem('k2')).toEqual(val(2)) // the write fell back to memory
  })
})
