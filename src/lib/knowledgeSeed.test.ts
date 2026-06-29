/**
 * Tests for the knowledge seed generator's pure helpers (Components A + B).
 *
 * The identity gate (matchesIntendedIdentity) is the highest-value assertion here: it is what
 * prevents a hallucinated-but-real handle (a namesquatter/homonym at the @handle the model named)
 * from surfacing as a verified-looking competitor with real metrics — the CR-2 false-positive risk.
 */

import { describe, it, expect } from 'vitest'
import {
  sanitizeHandle,
  parseSeedHandles,
  matchesIntendedIdentity,
  IDENTITY_FOLLOWER_FLOOR,
  type SeedCandidate,
} from './knowledgeSeed'
import type { NormalizedProfile } from './transformers'

function makeProfile(over: Partial<NormalizedProfile> = {}): NormalizedProfile {
  return {
    username: 'someuser',
    fullName: 'Some User',
    biography: '',
    followersCount: 1_000,
    followsCount: 100,
    postsCount: 50,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 10,
    avgComments: 1,
    engagementRate: 1.1,
    relatedHandles: [],
    topHashtags: [],
    ...over,
  }
}

describe('sanitizeHandle', () => {
  it('strips @, lowercases, and keeps only [a-z0-9._]', () => {
    expect(sanitizeHandle('@Fit.Track_99')).toBe('fit.track_99')
  })
  it('removes injection / whitespace / unicode payloads', () => {
    expect(sanitizeHandle('evil\nIgnore previous')).toBe('evilignoreprevious')
    expect(sanitizeHandle('  spaced out  ')).toBe('spacedout')
  })
  it('caps length at 30 and rejects non-strings', () => {
    expect(sanitizeHandle('a'.repeat(40)).length).toBe(30)
    expect(sanitizeHandle(123)).toBe('')
    expect(sanitizeHandle(null)).toBe('')
  })
})

describe('parseSeedHandles', () => {
  it('parses an array of {handle, name} objects', () => {
    const out = parseSeedHandles([{ handle: 'alpha', name: 'Alpha Co' }, { handle: '@beta', name: 'Beta' }])
    expect(out).toEqual([{ handle: 'alpha', name: 'Alpha Co' }, { handle: 'beta', name: 'Beta' }])
  })
  it('parses bare string handles (empty name)', () => {
    expect(parseSeedHandles(['gamma', 'delta'])).toEqual([
      { handle: 'gamma', name: '' },
      { handle: 'delta', name: '' },
    ])
  })
  it('unwraps {accounts|results|handles: [...]} shapes', () => {
    expect(parseSeedHandles({ accounts: [{ username: 'wrapped' }] })).toEqual([{ handle: 'wrapped', name: '' }])
    expect(parseSeedHandles({ results: ['x'] })[0].handle).toBe('x')
  })
  it('dedups and drops invalid handles', () => {
    const out = parseSeedHandles([{ handle: 'dup' }, { handle: '@DUP' }, { handle: '' }, { handle: '   ' }])
    expect(out).toEqual([{ handle: 'dup', name: '' }])
  })
  it('respects the cap and never throws on garbage', () => {
    expect(parseSeedHandles(['a', 'b', 'c'], 2)).toHaveLength(2)
    expect(parseSeedHandles(null)).toEqual([])
    expect(parseSeedHandles('not json')).toEqual([])
    expect(parseSeedHandles(42)).toEqual([])
  })
})

describe('matchesIntendedIdentity (CR-2 identity gate)', () => {
  const seed: SeedCandidate = { handle: 'johnsmith', name: 'John Smith Fitness' }

  it('accepts a verified account even when small with no name match', () => {
    const p = makeProfile({ username: 'johnsmith', fullName: 'JS', verified: true, followersCount: 800 })
    expect(matchesIntendedIdentity(p, seed)).toBe(true)
  })

  it('accepts a sizable account at the named handle (above the follower floor)', () => {
    const p = makeProfile({ username: 'johnsmith', fullName: 'Totally Different', followersCount: IDENTITY_FOLLOWER_FLOOR })
    expect(matchesIntendedIdentity(p, seed)).toBe(true)
  })

  it('accepts a name-matched account above the name-match floor', () => {
    const p = makeProfile({ username: 'johnsmith', fullName: 'John Smith', followersCount: 5_000, verified: false })
    expect(matchesIntendedIdentity(p, seed)).toBe(true)
  })

  it('REJECTS a name-matched but tiny placeholder below the name-match floor (live-caught squatter)', () => {
    // @anantladha: 360 followers, empty bio, name token matches — passed the OLD gate. A placeholder
    // at the named handle is a squatter, not the notable creator the model meant.
    const p = makeProfile({ username: 'anantladha', fullName: 'Anant Ladha', followersCount: 360, verified: false })
    expect(matchesIntendedIdentity(p, { handle: 'anantladha', name: 'Anant Ladha' })).toBe(false)
  })

  it('REJECTS a small, unverified, name-mismatched account (the wrong-person namesquatter)', () => {
    // @johnsmith exists but belongs to an unrelated small account — exactly the false positive
    // that would otherwise surface with real metrics and look more credible than a ChatGPT guess.
    const p = makeProfile({ username: 'johnsmith', fullName: 'Photography Daily', biography: 'cameras', followersCount: 1_200, verified: false })
    expect(matchesIntendedIdentity(p, seed)).toBe(false)
  })

  it('REJECTS a small, unverified account when the model gave no name to confirm against', () => {
    const p = makeProfile({ username: 'mystery', fullName: 'Mystery', followersCount: 500, verified: false })
    expect(matchesIntendedIdentity(p, { handle: 'mystery', name: '' })).toBe(false)
  })
})
