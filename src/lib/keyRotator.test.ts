/**
 * Unit tests for keyRotator — isKeyCoolingDown and markKeyCooldown.
 *
 * storage.ts uses an in-memory Map under Node, so no mocking is needed.
 * Fake timers let us jump past the 15-minute cooldown window without waiting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isKeyCoolingDown, markKeyCooldown } from './keyRotator'
import storage from './storage'

const COOLDOWN_MS = 15 * 60 * 1000 // mirrors the constant in keyRotator.ts

beforeEach(() => {
  // Reset the cooldown map between tests so state doesn't bleed across cases.
  storage.set('apify_key_cooldowns', '{}')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isKeyCoolingDown', () => {
  it('returns false for a key that has never been marked', () => {
    expect(isKeyCoolingDown('never-marked-key')).toBe(false)
  })

  it('returns true immediately after markKeyCooldown is called', () => {
    markKeyCooldown('my-key')
    expect(isKeyCoolingDown('my-key')).toBe(true)
  })

  it('returns false after the cooldown window expires', () => {
    vi.useFakeTimers()
    markKeyCooldown('expiring-key')

    // Advance time past the 15-minute cooldown
    vi.advanceTimersByTime(COOLDOWN_MS + 1)

    expect(isKeyCoolingDown('expiring-key')).toBe(false)
  })
})
