import { describe, it, expect } from 'vitest'
import { pickRunKey } from './apifyCore'

/**
 * After Phase 1, pickRunKey is a no-op shim: key selection happens on the server
 * (api/apify.ts). The function returns '' for all inputs so callers compile unchanged
 * and the proxy ignores the passed value.
 */
describe('pickRunKey (Phase 1 proxy shim)', () => {
  it('returns empty string for a non-empty key pool (server selects key)', () => {
    expect(pickRunKey(['k1', 'k2'])).toBe('')
  })

  it('returns empty string for an empty pool (server has its own keys)', () => {
    expect(pickRunKey([])).toBe('')
  })

  it('never throws regardless of input', () => {
    expect(() => pickRunKey([])).not.toThrow()
    expect(() => pickRunKey(['k1'])).not.toThrow()
  })
})
