/**
 * Tests for the null-guard patches added on feat/location-discovery:
 *   1. null/undefined username → normalised to empty string
 *   2. relatedProfile with empty or null username is filtered out
 *   3. non-string hashtag values are skipped (no crash)
 *   4. discoverySource field is NOT set by normalizeProfile (caller responsibility)
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

describe('normalizeProfile — discoverySource field (source-tagging)', () => {
  it('does not set discoverySource — it is the caller\'s responsibility', () => {
    const raw = makeRaw({ username: 'someuser' })
    const profile = normalizeProfile(raw)
    // normalizeProfile must NOT set discoverySource — apifyClient.ts sets it after scraping
    expect(profile.discoverySource).toBeUndefined()
  })

  it('preserves discoverySource when spread-tagged by caller', () => {
    const raw = makeRaw({ username: 'hashtaguser' })
    const profile = normalizeProfile(raw)
    // Simulate apifyClient.ts tagging: { ...p, discoverySource: 'hashtag' }
    const tagged = { ...profile, discoverySource: 'hashtag' as const }
    expect(tagged.discoverySource).toBe('hashtag')
    // Other fields must not be mutated by the spread
    expect(tagged.username).toBe('hashtaguser')
  })

  it('accepts all valid DiscoverySource values', () => {
    const raw = makeRaw()
    const profile = normalizeProfile(raw)
    const sources = ['input', 'relatedProfiles', 'hashtag', 'round3'] as const
    for (const source of sources) {
      const tagged = { ...profile, discoverySource: source }
      expect(tagged.discoverySource).toBe(source)
    }
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

describe('normalizeProfile — hashtag noise filtering (relevance fix)', () => {
  it('drops commercial/collab stopwords, numeric and ultra-short tags', () => {
    const raw = makeRaw({
      latestPosts: [
        {
          likesCount: 100,
          commentsCount: 5,
          timestamp: '2024-01-01',
          // 'fitness' twice (recurring); the rest are noise that must be dropped
          hashtags: ['fitness', 'fitness', 'ad', 'collab', 'sponsored', '6', '30', 'ab'],
        } as never,
      ],
    })
    const profile = normalizeProfile(raw)
    expect(profile.topHashtags).toContain('fitness')
    for (const noise of ['ad', 'collab', 'sponsored', '6', '30', 'ab']) {
      expect(profile.topHashtags).not.toContain(noise)
    }
  })

  it('applies a min-frequency floor: drops single-occurrence tags when >=3 recur', () => {
    const raw = makeRaw({
      latestPosts: [
        {
          likesCount: 10,
          commentsCount: 1,
          timestamp: '2024-01-01',
          // marketing/branding/content recur (freq 2); 'fluke' appears once
          hashtags: ['marketing', 'marketing', 'branding', 'branding', 'content', 'content', 'fluke'],
        } as never,
      ],
    })
    const profile = normalizeProfile(raw)
    expect(profile.topHashtags).toEqual(expect.arrayContaining(['marketing', 'branding', 'content']))
    expect(profile.topHashtags).not.toContain('fluke')
  })

  it('falls back to single-occurrence tags when fewer than 3 recur (sparse profile)', () => {
    const raw = makeRaw({
      latestPosts: [
        {
          likesCount: 10,
          commentsCount: 1,
          timestamp: '2024-01-01',
          hashtags: ['yoga', 'pilates'], // both freq 1, none recur — must still survive
        } as never,
      ],
    })
    const profile = normalizeProfile(raw)
    expect(profile.topHashtags).toEqual(expect.arrayContaining(['yoga', 'pilates']))
  })
})

describe('normalizeProfile — lastPostDate ignores pinned-post ordering', () => {
  it('returns the newest timestamp even when latestPosts[0] is an old pinned post', () => {
    const raw = makeRaw({
      latestPosts: [
        { timestamp: '2025-01-01T00:00:00.000Z', isPinned: true } as never,
        { timestamp: '2026-06-01T00:00:00.000Z' } as never,
        { timestamp: '2026-05-15T00:00:00.000Z' } as never,
      ],
    })
    expect(normalizeProfile(raw).lastPostDate).toBe('2026-06-01T00:00:00.000Z')
  })

  it('returns undefined when no post has a parseable timestamp', () => {
    const raw = makeRaw({
      latestPosts: [
        { timestamp: 'not-a-date' } as never,
        {} as never,
      ],
    })
    expect(normalizeProfile(raw).lastPostDate).toBeUndefined()
  })

  it('returns undefined when latestPosts is missing', () => {
    const raw = makeRaw({ latestPosts: undefined })
    expect(normalizeProfile(raw).lastPostDate).toBeUndefined()
  })
})
