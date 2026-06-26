/**
 * Tests for the knowledge seed generator's pure helpers (Components A + B).
 *
 * The identity gate (matchesIntendedIdentity) is the highest-value assertion here: it is what
 * prevents a hallucinated-but-real handle (a namesquatter/homonym at the @handle the model named)
 * from surfacing as a verified-looking competitor with real metrics — the CR-2 false-positive risk.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// generateNicheSeeds runs ONE web-grounded call; mock it so the test stays pure + offline.
vi.mock('../ai/gemini', () => ({ callGeminiGroundedJson: vi.fn() }))

import {
  sanitizeHandle,
  parseSeedHandles,
  parseNicheSeedResult,
  generateNicheSeeds,
  matchesIntendedIdentity,
  IDENTITY_FOLLOWER_FLOOR,
  type SeedCandidate,
} from './knowledgeSeed'
import { callGeminiGroundedJson } from '../ai/gemini'
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

describe('parseNicheSeedResult', () => {
  it('extracts the niche briefing AND candidate accounts from the grounded object', () => {
    const out = parseNicheSeedResult({
      briefing: 'This niche centers on home-gym strength coaches; sub-niches: kettlebell, calisthenics.',
      accounts: [{ handle: 'alpha', name: 'Alpha Co' }, { handle: '@beta', name: 'Beta' }],
    })
    expect(out.briefing).toBe('This niche centers on home-gym strength coaches; sub-niches: kettlebell, calisthenics.')
    expect(out.candidates).toEqual([{ handle: 'alpha', name: 'Alpha Co' }, { handle: 'beta', name: 'Beta' }])
  })

  it('accepts niche_brief as an alias for briefing', () => {
    expect(parseNicheSeedResult({ niche_brief: 'brief text', accounts: ['x'] }).briefing).toBe('brief text')
  })

  it('degrades to an empty briefing + parsed candidates when no briefing key is present', () => {
    const out = parseNicheSeedResult([{ handle: 'gamma' }])
    expect(out.briefing).toBe('')
    expect(out.candidates).toEqual([{ handle: 'gamma', name: '' }])
  })

  it('never throws on garbage and returns empty briefing + candidates', () => {
    expect(parseNicheSeedResult(null)).toEqual({ briefing: '', candidates: [] })
    expect(parseNicheSeedResult('not json')).toEqual({ briefing: '', candidates: [] })
    expect(parseNicheSeedResult(42)).toEqual({ briefing: '', candidates: [] })
  })

  it('respects the candidate cap', () => {
    const out = parseNicheSeedResult({ briefing: 'b', accounts: ['a', 'b', 'c'] }, 2)
    expect(out.candidates).toHaveLength(2)
  })

  it('strips control chars and caps briefing length', () => {
    const out = parseNicheSeedResult({ briefing: 'line1\nline2\r\n' + 'x'.repeat(3000), accounts: [] })
    expect(out.briefing).not.toContain('\n')
    expect(out.briefing.length).toBeLessThanOrEqual(2000)
  })
})

describe('generateNicheSeeds', () => {
  beforeEach(() => vi.mocked(callGeminiGroundedJson).mockReset())

  it('returns the web-grounded briefing AND candidates from the combined grounded call', async () => {
    vi.mocked(callGeminiGroundedJson).mockResolvedValueOnce({
      niche_brief: 'Home-gym strength coaching; kettlebell + calisthenics sub-niches.',
      accounts: [{ handle: 'coachA', name: 'Coach A' }, { handle: '@coachB', name: 'Coach B' }],
    })
    const res = await generateNicheSeeds(['key'], 'home-gym coaching', [], 'precise')
    expect(res.briefing).toBe('Home-gym strength coaching; kettlebell + calisthenics sub-niches.')
    expect(res.candidates).toEqual([{ handle: 'coacha', name: 'Coach A' }, { handle: 'coachb', name: 'Coach B' }])
  })

  it('degrades to an empty briefing + candidates when the grounded call throws (never aborts the run)', async () => {
    vi.mocked(callGeminiGroundedJson).mockRejectedValueOnce(new Error('grounding down'))
    expect(await generateNicheSeeds(['key'], 'fitness', [], 'precise')).toEqual({ briefing: '', candidates: [] })
  })

  it('skips the model entirely for a blank niche', async () => {
    expect(await generateNicheSeeds(['key'], '   ', [], 'precise')).toEqual({ briefing: '', candidates: [] })
    expect(callGeminiGroundedJson).not.toHaveBeenCalled()
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

  it('accepts a small account when the scraped name shares a token with the intended name', () => {
    const p = makeProfile({ username: 'johnsmith', fullName: 'John Smith', followersCount: 900, verified: false })
    expect(matchesIntendedIdentity(p, seed)).toBe(true)
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
