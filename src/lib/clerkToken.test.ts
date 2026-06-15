/**
 * Tests for the Clerk token accessor — focused on the concurrent-coalescing behavior added
 * to fix the deep-report 401 storm: a burst of parallel proxy calls (pLimit) must share ONE
 * getToken() call so concurrent Clerk refreshes can't resolve null and drop the auth header.
 */
import { describe, it, expect } from 'vitest'
import { setClerkTokenGetter, getClerkSessionToken } from './clerkToken'

describe('getClerkSessionToken — concurrent coalescing', () => {
  it('coalesces a concurrent burst onto a single getToken() call', async () => {
    let calls = 0
    let resolveFn: (v: string) => void = () => {}
    setClerkTokenGetter(() => {
      calls++
      return new Promise<string>((r) => { resolveFn = r })
    })
    // Fire 5 callers BEFORE the getter resolves — they must share one in-flight fetch.
    const burst = Promise.all([1, 2, 3, 4, 5].map(() => getClerkSessionToken()))
    resolveFn('tok-1')
    const results = await burst
    expect(calls).toBe(1) // ONE getToken() for the whole burst, not five
    expect(results).toEqual(['tok-1', 'tok-1', 'tok-1', 'tok-1', 'tok-1'])
  })

  it('starts a fresh getToken() for a call made after the in-flight one settled', async () => {
    let calls = 0
    setClerkTokenGetter(async () => `tok-${++calls}`)
    const a = await getClerkSessionToken()
    const b = await getClerkSessionToken()
    expect(a).toBe('tok-1')
    expect(b).toBe('tok-2') // not coalesced once the first settled — each gets a fresh token
    expect(calls).toBe(2)
  })

  it('returns null when the wired getter yields null (signed out)', async () => {
    setClerkTokenGetter(async () => null)
    expect(await getClerkSessionToken()).toBeNull()
  })
})
