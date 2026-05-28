/**
 * Tests for the null-guard patches added on feat/location-discovery:
 *   1. null/undefined username → normalised to empty string
 *   2. relatedProfile with empty or null username is filtered out
 *   3. non-string hashtag values are skipped (no crash)
 */

import { describe, it, expect } from 'vitest'
import { normalizeProfile } from './transformers'
import type { ApifyProfileRaw } from './transformers'

function makeRaw(overrides: Partial<ApifyProfileRaw> = {}): ApifyProfileRaw {
  return {
    username: 'testuser',
    fullName: 'Test User',
    biography: 'A test bio',
    followersCount: 1000,
    followsCount: 200,
    postsCount: 50,
    profilePicUrl: 'https://example.com/pic.jpg',
    verified: false,
    isBusinessAccount: false,
    private: false,
    latestPosts: [],
    relatedProfiles: [],
    ...overrides,
  }
}

describe('normalizeProfile — null username guard (diff patch)', () => {
  it('returns empty string when raw.username is null', () => {
    // Cast to bypass TS strictness — Apify can return null here
    const raw = makeRaw({ username: null as unknown as string })
    expect(normalizeProfile(raw).username).toBe('')
  })

  it('returns empty string when raw.username is undefined', () => {
    const raw = makeRaw({ username: undefined as unknown as string })
    expect(normalizeProfile(raw).username).toBe('')
  })

  it('preserves a valid username unchanged', () => {
    const raw = makeRaw({ username: 'validuser' })
    expect(normalizeProfile(raw).username).toBe('validuser')
  })
})

describe('normalizeProfile — relatedProfiles null username guard (diff patch)', () => {
  it('filters out relatedProfile with empty username', () => {
    const raw = makeRaw({
      relatedProfiles: [
        { username: '', is_private: false },
        { username: 'goodhandle', is_private: false },
      ],
    })
    const profile = normalizeProfile(raw)
    expect(profile.relatedHandles).not.toContain('')
    expect(profile.relatedHandles).toContain('goodhandle')
  })

  it('filters out relatedProfile with null username', () => {
    const raw = makeRaw({
      relatedProfiles: [
        { username: null as unknown as string, is_private: false },
        { username: 'alice', is_private: false },
      ],
    })
    const profile = normalizeProfile(raw)
    expect(profile.relatedHandles).not.toContain(null)
    expect(profile.relatedHandles).toContain('alice')
  })

  it('still filters out private profiles even with valid username', () => {
    const raw = makeRaw({
      relatedProfiles: [
        { username: 'privateuser', is_private: true },
        { username: 'publicuser', is_private: false },
      ],
    })
    const profile = normalizeProfile(raw)
    expect(profile.relatedHandles).not.toContain('privateuser')
    expect(profile.relatedHandles).toContain('publicuser')
  })
})

describe('normalizeProfile — non-string hashtag guard (diff patch)', () => {
  it('skips non-string hashtag values without throwing', () => {
    const raw = makeRaw({
      latestPosts: [
        {
          likesCount: 100,
          commentsCount: 5,
          timestamp: '2024-01-01',
          // Mix valid strings and non-strings
          hashtags: ['foodie', null as unknown as string, 42 as unknown as string, 'travel'],
        },
      ],
    })
    // Should not throw, and only valid string tags should appear
    const profile = normalizeProfile(raw)
    expect(profile.topHashtags).toContain('foodie')
    expect(profile.topHashtags).toContain('travel')
    // null and number should have been skipped
    expect(profile.topHashtags).not.toContain(null)
    expect(profile.topHashtags.some((t) => typeof t !== 'string')).toBe(false)
  })

  it('returns empty topHashtags when all hashtag entries are non-strings', () => {
    const raw = makeRaw({
      latestPosts: [
        {
          likesCount: 10,
          commentsCount: 0,
          timestamp: '2024-01-01',
          hashtags: [null as unknown as string, undefined as unknown as string],
        },
      ],
    })
    const profile = normalizeProfile(raw)
    expect(profile.topHashtags).toEqual([])
  })
})
