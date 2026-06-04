import { describe, it, expect, beforeEach } from 'vitest'
import { useKeysStore } from './keysStore'

/**
 * Apify keys have no fixed cap — the rotator (pickAvailableKey) round-robins any array
 * length, so the store should keep as many keys as the user adds (was hard-capped at 10).
 */
beforeEach(() => {
  useKeysStore.getState().setApifyKeys([])
})

describe('keysStore — Apify keys (no fixed cap)', () => {
  it('setApifyKeys retains more than 10 keys', () => {
    const keys = Array.from({ length: 14 }, (_, i) => `apify-key-${i + 1}`)
    useKeysStore.getState().setApifyKeys(keys)
    expect(useKeysStore.getState().apifyKeys).toHaveLength(14)
  })

  it('addApifyKey accepts keys beyond the old 10-key cap', () => {
    useKeysStore.getState().setApifyKeys(Array.from({ length: 10 }, (_, i) => `k${i + 1}`))
    useKeysStore.getState().addApifyKey('k11')
    expect(useKeysStore.getState().apifyKeys).toContain('k11')
    expect(useKeysStore.getState().apifyKeys).toHaveLength(11)
  })

  it('addApifyKey still dedupes', () => {
    useKeysStore.getState().setApifyKeys(['a', 'b'])
    useKeysStore.getState().addApifyKey('a')
    expect(useKeysStore.getState().apifyKeys).toHaveLength(2)
  })
})
