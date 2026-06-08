/**
 * The Supabase client must construct safely at import (placeholder env in tests) and
 * expose setClerkTokenGetter so module-level stores can supply the Clerk JWT lazily.
 */
import { describe, it, expect } from 'vitest'
import { supabase, setClerkTokenGetter } from './supabaseClient'

describe('supabaseClient', () => {
  it('constructs a client at import without throwing', () => {
    expect(supabase).toBeTruthy()
    expect(typeof supabase.from).toBe('function')
  })

  it('exposes setClerkTokenGetter as a function', () => {
    expect(typeof setClerkTokenGetter).toBe('function')
    // wiring a getter must not throw
    expect(() => setClerkTokenGetter(async () => 'tok')).not.toThrow()
  })
})
