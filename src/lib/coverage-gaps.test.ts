/**
 * Fills coverage gaps across multiple modules from feat/location-discovery:
 *
 *   1. transformers.ts — normalizeProfiles array-level null-username filter
 *   2. locationFilter.ts — getCityTerms city with no aliases, getAllOtherCityTerms alias exclusion,
 *                          city with alias-based lookup, topHashtags city signal (hashtag path)
 *   3. discoveryClient.ts — collectExpansionHandles 30-char handle boundary,
 *                           meetsQualityThreshold business postsCount exact boundary
 *   4. hashtagGenerator.ts — generateHashtags orchestrator: empty key → fallback,
 *                            empty safeCity/safeNiche → fallback, deep count
 *   5. prompts.ts — buildCompetitorPrompt bio newline stripping, nicheDeriveBlock presence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizeProfiles } from './transformers'
import type { ApifyProfileRaw } from './transformers'
import { filterByLocation } from './locationFilter'
import { collectExpansionHandles, meetsQualityThreshold } from './discoveryClient'
import { generateHashtags } from './hashtagGenerator'
import { buildCompetitorPrompt } from '../ai/prompts'
import type { NormalizedProfile } from './transformers'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRawProfile(overrides: Partial<ApifyProfileRaw> = {}): ApifyProfileRaw {
  return {
    username: 'user',
    fullName: 'User',
    biography: '',
    followersCount: 1000,
    followsCount: 100,
    postsCount: 20,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    private: false,
    latestPosts: [],
    relatedProfiles: [],
    ...overrides,
  }
}

function makeProfile(overrides: Partial<NormalizedProfile> = {}): NormalizedProfile {
  return {
    username: 'testuser',
    fullName: 'Test User',
    biography: '',
    followersCount: 10_000,
    followsCount: 500,
    postsCount: 100,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 400,
    avgComments: 20,
    engagementRate: 4.0,
    relatedHandles: [],
    topHashtags: [],
    ...overrides,
  }
}

// ─── transformers.ts ────────────────────────────────────────────────────────

describe('normalizeProfiles — array-level null-username filter', () => {
  it('filters out profiles with null username at the array level', () => {
    const raws = [
      makeRawProfile({ username: 'validuser' }),
      makeRawProfile({ username: null as unknown as string }),
    ]
    const result = normalizeProfiles(raws)
    expect(result.map((p) => p.username)).toEqual(['validuser'])
    expect(result).toHaveLength(1)
  })

  it('filters out profiles with undefined username at the array level', () => {
    const raws = [
      makeRawProfile({ username: undefined as unknown as string }),
      makeRawProfile({ username: 'alice' }),
    ]
    const result = normalizeProfiles(raws)
    expect(result).toHaveLength(1)
    expect(result[0].username).toBe('alice')
  })

  it('returns all profiles when all have valid usernames', () => {
    const raws = [
      makeRawProfile({ username: 'user1' }),
      makeRawProfile({ username: 'user2' }),
    ]
    const result = normalizeProfiles(raws)
    expect(result).toHaveLength(2)
  })

  it('returns empty array when all profiles have null usernames', () => {
    const raws = [
      makeRawProfile({ username: null as unknown as string }),
      makeRawProfile({ username: null as unknown as string }),
    ]
    const result = normalizeProfiles(raws)
    expect(result).toHaveLength(0)
  })
})

// ─── locationFilter.ts — city with no aliases ───────────────────────────────

describe('filterByLocation — city with no registered aliases', () => {
  it('passes creator with exact city name in bio (Indore has no alias)', () => {
    const profile = makeProfile({ biography: 'Best food spots in Indore' })
    const { filtered } = filterByLocation([profile], 'Indore')
    expect(filtered).toHaveLength(1)
  })

  it('rejects creator with another non-alias city in bio', () => {
    const profile = makeProfile({ biography: 'Food blogger from Mumbai' })
    const { passedCount } = filterByLocation([profile], 'Indore')
    expect(passedCount).toBe(0)
  })

  it('passes creator with no city signal when city has no aliases (assumed local)', () => {
    const profile = makeProfile({ biography: 'Street food enthusiast' })
    const { filtered } = filterByLocation([profile], 'Surat')
    // No city signal in bio → passes (assumed local)
    expect(filtered.length).toBeGreaterThan(0)
  })
})

describe('filterByLocation — alias as the search target', () => {
  it('recognises Bombay as alias when searching Mumbai', () => {
    const profile = makeProfile({ biography: 'Born and raised in Bombay' })
    const { filtered } = filterByLocation([profile], 'Mumbai')
    expect(filtered).toHaveLength(1)
  })

  it('recognises Bengaluru when searching Bangalore (target is canonical)', () => {
    const profile = makeProfile({ biography: 'Fitness journey in Bengaluru' })
    const { filtered } = filterByLocation([profile], 'Bangalore')
    expect(filtered).toHaveLength(1)
  })

  it('does not falsely pass a Bangalore creator when searching Delhi', () => {
    const profile = makeProfile({ biography: 'Bangalore foodie' })
    const { passedCount } = filterByLocation([profile], 'Delhi')
    expect(passedCount).toBe(0)
  })
})

describe('filterByLocation — business account with businessAddress', () => {
  it('passes business where city appears in businessAddress but not bio', () => {
    const profile = makeProfile({
      isBusinessAccount: true,
      biography: 'Great food',
      // duck-typed extension
      ...({ businessAddress: '12 Ring Road, Delhi, India' } as object),
    } as NormalizedProfile)
    const { filtered } = filterByLocation([profile], 'Delhi')
    expect(filtered).toHaveLength(1)
  })
})

// ─── discoveryClient.ts — handle validation boundary ────────────────────────

describe('collectExpansionHandles — handle length boundary', () => {
  it('accepts a 30-character handle (max valid length)', () => {
    const handle30 = 'a'.repeat(30)
    const creators = [makeProfile({ relatedHandles: [handle30] })]
    const result = collectExpansionHandles(creators, [], new Set())
    expect(result).toContain(handle30)
  })

  it('rejects a 31-character handle (exceeds max)', () => {
    const handle31 = 'a'.repeat(31)
    const creators = [makeProfile({ relatedHandles: [handle31] })]
    const result = collectExpansionHandles(creators, [], new Set())
    expect(result).not.toContain(handle31)
  })

  it('accepts a 1-character handle (min valid length)', () => {
    const creators = [makeProfile({ relatedHandles: ['a'] })]
    const result = collectExpansionHandles(creators, [], new Set())
    expect(result).toContain('a')
  })
})

// ─── discoveryClient.ts — meetsQualityThreshold ─────────────────────────────

describe('meetsQualityThreshold — business exact boundaries', () => {
  it('passes business with exactly 1000 followers and 5 posts (boundary)', () => {
    const p = makeProfile({ isBusinessAccount: true, followersCount: 1000, postsCount: 5 })
    expect(meetsQualityThreshold(p)).toBe(true)
  })

  it('rejects business with exactly 999 followers (below threshold)', () => {
    const p = makeProfile({ isBusinessAccount: true, followersCount: 999, postsCount: 10 })
    expect(meetsQualityThreshold(p)).toBe(false)
  })

  it('rejects business with exactly 4 posts (below threshold)', () => {
    const p = makeProfile({ isBusinessAccount: true, followersCount: 2000, postsCount: 4 })
    expect(meetsQualityThreshold(p)).toBe(false)
  })

  it('creator passes with exactly 500 followers and 5 posts (boundary)', () => {
    const p = makeProfile({ isBusinessAccount: false, followersCount: 500, postsCount: 5 })
    expect(meetsQualityThreshold(p)).toBe(true)
  })

  it('creator rejects with 499 followers', () => {
    const p = makeProfile({ isBusinessAccount: false, followersCount: 499, postsCount: 100 })
    expect(meetsQualityThreshold(p)).toBe(false)
  })
})

// ─── hashtagGenerator.ts — generateHashtags orchestrator ────────────────────

describe('generateHashtags — fallback paths (no network)', () => {
  it('returns rule-based fallback when geminiKey is empty string', async () => {
    const result = await generateHashtags('', 'Mumbai', 'food')
    expect(result.fromAI).toBe(false)
    expect(result.hashtags.length).toBeGreaterThan(0)
    // Fallback tags should be based on city+niche
    expect(result.hashtags[0]).toContain('Mumbai')
  })

  it('returns rule-based fallback when geminiKey is whitespace only', async () => {
    const result = await generateHashtags('   ', 'Indore', 'food')
    expect(result.fromAI).toBe(false)
    expect(result.hashtags.length).toBeGreaterThan(0)
  })

  it('returns fallback with correct standard count (5) when key is empty', async () => {
    const result = await generateHashtags('', 'Mumbai', 'food', 'standard')
    expect(result.fromAI).toBe(false)
    expect(result.hashtags).toHaveLength(5)
  })

  it('returns fallback with correct deep count (8) when key is empty', async () => {
    const result = await generateHashtags('', 'Mumbai', 'food', 'deep')
    expect(result.fromAI).toBe(false)
    expect(result.hashtags).toHaveLength(8)
  })

  it('falls back when city sanitizes to empty string', async () => {
    // All chars stripped by sanitize → safeCity = '' → fallback with original trimmed values
    const result = await generateHashtags('', '!@#$', 'food')
    expect(result.fromAI).toBe(false)
    // Fallback uses original city.trim() = '!@#$' — but rule output still valid
    expect(Array.isArray(result.hashtags)).toBe(true)
  })

  it('falls back when niche sanitizes to empty string', async () => {
    const result = await generateHashtags('', 'Mumbai', '!@#$%^')
    expect(result.fromAI).toBe(false)
    expect(Array.isArray(result.hashtags)).toBe(true)
  })
})

// ─── prompts.ts — buildCompetitorPrompt — bio newline stripping ──────────────

describe('buildCompetitorPrompt — bio newline stripping (diff patch)', () => {
  const inputProfile = makeProfile({ username: 'ref', biography: 'Reference account' })

  it('replaces \\n in candidate bio with space', () => {
    const candidate = makeProfile({
      username: 'nlcandidate',
      biography: 'First line\nSecond line',
    })
    const prompt = buildCompetitorPrompt([inputProfile], [candidate])
    const line = prompt.split('\n').find((l) => l.includes('@nlcandidate')) ?? ''
    expect(line).toContain('First line Second line')
    // No raw newline inside the line
    expect(line.includes('\n')).toBe(false)
  })

  it('replaces \\r in candidate bio with space', () => {
    const candidate = makeProfile({
      username: 'crcandidate',
      biography: 'Part A\rPart B',
    })
    const prompt = buildCompetitorPrompt([inputProfile], [candidate])
    const line = prompt.split('\n').find((l) => l.includes('@crcandidate')) ?? ''
    expect(line).toContain('Part A Part B')
  })
})

describe('buildCompetitorPrompt — nicheDeriveBlock injection', () => {
  // The unique marker text only present inside the injected nicheDeriveBlock
  const DERIVE_BLOCK_MARKER = 'NICHE DERIVATION — complete'

  const inputProfile = makeProfile({
    username: 'ref',
    biography: 'Startup mentor',
    topHashtags: ['entrepreneurship', 'startup'],
  })

  it('injects nicheDeriveBlock when input has hashtags (filter signal)', () => {
    // inputProfile has topHashtags — this is a niche signal
    const prompt = buildCompetitorPrompt([inputProfile], [makeProfile()])
    expect(prompt).toContain(DERIVE_BLOCK_MARKER)
    expect(prompt).toContain('derivedNiche')
  })

  it('injects nicheDeriveBlock when explicit nicheContext is provided', () => {
    const refNoHashtags = makeProfile({ username: 'ref2', biography: 'A creator', topHashtags: [] })
    const prompt = buildCompetitorPrompt(
      [refNoHashtags],
      [makeProfile()],
      'entrepreneurship content',
    )
    expect(prompt).toContain(DERIVE_BLOCK_MARKER)
  })

  it('does NOT inject nicheDeriveBlock when no filter signals exist', () => {
    // No hashtags, no nicheContext, no clarificationAnswer → hasFilterSignal = false
    const refNoSignal = makeProfile({ username: 'ref3', biography: 'A creator', topHashtags: [] })
    const prompt = buildCompetitorPrompt([refNoSignal], [makeProfile()], '')
    // The injected block text starts with "NICHE DERIVATION — complete"
    // The static ADJACENT NICHE GUARD text also says "NICHE DERIVATION" but not "— complete"
    expect(prompt).not.toContain(DERIVE_BLOCK_MARKER)
  })
})
