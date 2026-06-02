/**
 * Tests for linkAbort — the Phase-1b silent-cancel-vs-timeout distinction.
 *
 * The whole point: an EXTERNAL abort (agent loop steering away) must be classified
 * as "superseded" (silent), while an INTERNAL timeout must NOT be — it's a real error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { linkAbort } from './abortControl'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('linkAbort', () => {
  it('external abort → work signal aborts AND wasSuperseded() is true (silent steer)', () => {
    const external = new AbortController()
    const a = linkAbort(150_000, external.signal)

    expect(a.signal.aborted).toBe(false)
    external.abort()

    expect(a.signal.aborted).toBe(true)       // work stops
    expect(a.wasSuperseded()).toBe(true)      // classified as intentional steer, not a failure
    a.cleanup()
  })

  it('internal timeout → work signal aborts BUT wasSuperseded() is false (real error)', () => {
    const a = linkAbort(150_000, new AbortController().signal)

    vi.advanceTimersByTime(150_000)

    expect(a.signal.aborted).toBe(true)       // work stops
    expect(a.wasSuperseded()).toBe(false)     // NOT superseded → buildErrorMessage will surface a timeout
    a.cleanup()
  })

  it('external already aborted before linking → aborts immediately, superseded', () => {
    const external = new AbortController()
    external.abort()
    const a = linkAbort(150_000, external.signal)

    expect(a.signal.aborted).toBe(true)
    expect(a.wasSuperseded()).toBe(true)
    a.cleanup()
  })

  it('cleanup() cancels the timer — no abort fires afterwards', () => {
    const a = linkAbort(150_000)
    a.cleanup()

    vi.advanceTimersByTime(150_000)

    expect(a.signal.aborted).toBe(false)      // timer was cleared; nothing aborts
  })

  it('no external signal → only the timeout can abort; never superseded', () => {
    const a = linkAbort(90_000)
    expect(a.wasSuperseded()).toBe(false)

    vi.advanceTimersByTime(90_000)
    expect(a.signal.aborted).toBe(true)
    expect(a.wasSuperseded()).toBe(false)
    a.cleanup()
  })
})
