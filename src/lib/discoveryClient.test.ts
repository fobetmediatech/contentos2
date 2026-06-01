import { describe, it, expect } from 'vitest'
import { isCreatorLikely, meetsQualityThreshold, collectExpansionHandles } from './discoveryClient'
import type { NormalizedProfile } from './transformers'

function makeProfile(overrides: Partial<NormalizedProfile>): NormalizedProfile {
  return {
    username: 'test',
    fullName: 'Test User',
    biography: '',
    followersCount: 10000,
    followsCount: 500,
    postsCount: 100,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 0,
    avgComments: 0,
    engagementRate: 3,
    topHashtags: [],
    relatedHandles: [],
    ...overrides,
  }
}

describe('isCreatorLikely', () => {
  it('returns true for non-business accounts (Signal 1)', () => {
    expect(isCreatorLikely(makeProfile({ isBusinessAccount: false }))).toBe(true)
  })

  it('returns true for business account with high follower ratio (Signal 2)', () => {
    const p = makeProfile({ isBusinessAccount: true, followersCount: 50000, followsCount: 100 })
    expect(isCreatorLikely(p)).toBe(true)
  })

  it('returns true for business account with creator bio keywords (Signal 3)', () => {
    // Low ratio (followersCount 1000, followsCount 990) — only bio keyword fires Signal 3
    const p = makeProfile({
      isBusinessAccount: true,
      biography: 'Food vlogger in Mumbai',
      followersCount: 1000,
      followsCount: 990,
    })
    expect(isCreatorLikely(p)).toBe(true)
  })

  it('returns true for business account with bio keyword when ratio is low', () => {
    const p = makeProfile({
      isBusinessAccount: true,
      biography: 'Official restaurant | content creator',
      followersCount: 1000,
      followsCount: 950, // ratio ~1.05 — not a creator by ratio
    })
    expect(isCreatorLikely(p)).toBe(true)
  })

  it('returns false when all three signals are absent', () => {
    const p = makeProfile({
      isBusinessAccount: true,
      biography: 'Best biryani in town',
      followersCount: 5000,
      followsCount: 4900, // ratio ~1.02
    })
    expect(isCreatorLikely(p)).toBe(false)
  })

  it('handles zero followsCount without throwing (Infinity ratio)', () => {
    const p = makeProfile({ isBusinessAccount: true, followsCount: 0 })
    expect(isCreatorLikely(p)).toBe(true)
  })

  it('matches various creator keywords in bio', () => {
    const keywords = ['vlogger', 'blogger', 'influencer', 'foodie', 'reviewer', 'content creator']
    for (const kw of keywords) {
      const p = makeProfile({
        isBusinessAccount: true,
        biography: `Mumbai ${kw}`,
        followersCount: 1000,
        followsCount: 990,
      })
      expect(isCreatorLikely(p), `keyword: ${kw}`).toBe(true)
    }
  })
})

describe('meetsQualityThreshold', () => {
  it('passes creator with ≥500 followers and ≥5 posts', () => {
    const p = makeProfile({ followersCount: 500, postsCount: 5 })
    expect(meetsQualityThreshold(p)).toBe(true)
  })

  it('rejects creator with <500 followers', () => {
    const p = makeProfile({ followersCount: 499, postsCount: 10 })
    expect(meetsQualityThreshold(p)).toBe(false)
  })

  it('rejects creator with <5 posts', () => {
    const p = makeProfile({ followersCount: 10000, postsCount: 4 })
    expect(meetsQualityThreshold(p)).toBe(false)
  })

  it('passes business with ≥1000 followers and ≥5 posts', () => {
    const p = makeProfile({ isBusinessAccount: true, followersCount: 1000, postsCount: 5 })
    expect(meetsQualityThreshold(p)).toBe(true)
  })

  it('rejects business with <1000 followers', () => {
    const p = makeProfile({ isBusinessAccount: true, followersCount: 999, postsCount: 10 })
    expect(meetsQualityThreshold(p)).toBe(false)
  })
})

describe('collectExpansionHandles', () => {
  it('returns related handles from creator profiles', () => {
    const creators = [makeProfile({ relatedHandles: ['alice', 'bob'] })]
    const result = collectExpansionHandles(creators, [], new Set())
    expect(result).toContain('alice')
    expect(result).toContain('bob')
  })

  it('falls back to business handles when creators have none', () => {
    const businesses = [makeProfile({ relatedHandles: ['bizuser'], isBusinessAccount: true })]
    const result = collectExpansionHandles([], businesses, new Set())
    expect(result).toContain('bizuser')
  })

  it('skips already-scraped handles', () => {
    const creators = [makeProfile({ relatedHandles: ['alice', 'bob'] })]
    const result = collectExpansionHandles(creators, [], new Set(['alice']))
    expect(result).not.toContain('alice')
    expect(result).toContain('bob')
  })

  it('rejects invalid handles (path traversal, query strings)', () => {
    const creators = [makeProfile({ relatedHandles: ['../admin', 'user?q=x', 'valid.handle'] })]
    const result = collectExpansionHandles(creators, [], new Set())
    expect(result).not.toContain('../admin')
    expect(result).not.toContain('user?q=x')
    expect(result).toContain('valid.handle')
  })

  it('normalizes handles to lowercase', () => {
    const creators = [makeProfile({ relatedHandles: ['IndoreFoodVlogger'] })]
    const result = collectExpansionHandles(creators, [], new Set())
    expect(result).toContain('indorefoodvlogger')
    expect(result).not.toContain('IndoreFoodVlogger')
  })

  it('deduplicates across profiles', () => {
    const creators = [
      makeProfile({ relatedHandles: ['alice', 'bob'], username: 'creator1' }),
      makeProfile({ relatedHandles: ['alice', 'carol'], username: 'creator2' }),
    ]
    const result = collectExpansionHandles(creators, [], new Set())
    expect(result.filter((h) => h === 'alice')).toHaveLength(1)
  })
})
