/**
 * Tests for buildDiscoveryPrompt — the location discovery Gemini prompt builder.
 *
 * Covers:
 *   1. Pool composition line — present only when BOTH creatorCount + businessCount provided
 *   2. Established label — injected for profiles with >500K followers
 *   3. Bio newline stripping — \n and \r replaced with space before injection
 *   4. Account type string — 'creator' vs 'business' based on isBusinessAccount
 *   5. Empty candidates list — prompt is still valid (no crash, CANDIDATE PROFILES block present)
 *   6. City and niche are injected into the prompt in the correct places
 *   7. BALANCE RULE and MINIMUM RESULT COUNT instructions are present
 *   8. Null/partial counts — only one of creatorCount/businessCount provided → no composition line
 */

import { describe, it, expect } from 'vitest'
import { buildDiscoveryPrompt } from './prompts'
import type { NormalizedProfile } from '../lib/transformers'

function makeProfile(overrides: Partial<NormalizedProfile> = {}): NormalizedProfile {
  return {
    username: 'testuser',
    fullName: 'Test User',
    biography: 'Food vlogger in Mumbai',
    followersCount: 10_000,
    followsCount: 500,
    postsCount: 80,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 400,
    avgComments: 20,
    engagementRate: 4.2,
    relatedHandles: [],
    topHashtags: ['foodie', 'mumbai'],
    ...overrides,
  }
}

describe('buildDiscoveryPrompt — pool composition line', () => {
  it('injects pool composition line when both creatorCount and businessCount are provided', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [makeProfile()], 7, 3)
    expect(prompt).toContain('CANDIDATE POOL COMPOSITION: 7 creator accounts')
    expect(prompt).toContain('3 business accounts')
  })

  it('does NOT inject pool composition line when only creatorCount is provided', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [makeProfile()], 7, undefined)
    expect(prompt).not.toContain('CANDIDATE POOL COMPOSITION')
  })

  it('does NOT inject pool composition line when only businessCount is provided', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [makeProfile()], undefined, 3)
    expect(prompt).not.toContain('CANDIDATE POOL COMPOSITION')
  })

  it('does NOT inject pool composition line when neither count is provided', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [makeProfile()])
    expect(prompt).not.toContain('CANDIDATE POOL COMPOSITION')
  })

  it('injects 0 counts correctly (edge: no creators, all business)', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [makeProfile()], 0, 10)
    expect(prompt).toContain('CANDIDATE POOL COMPOSITION: 0 creator accounts')
    expect(prompt).toContain('10 business accounts')
  })
})

describe('buildDiscoveryPrompt — established label', () => {
  it('injects [ESTABLISHED] label for profiles with >500K followers', () => {
    const bigProfile = makeProfile({ username: 'bigcreator', followersCount: 600_000 })
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [bigProfile])
    const line = prompt.split('\n').find((l) => l.includes('@bigcreator')) ?? ''
    expect(line).toContain('[ESTABLISHED: 500K+ followers — assign to Top category]')
  })

  it('does NOT inject [ESTABLISHED] label for profiles with exactly 500K followers', () => {
    const profile = makeProfile({ username: 'borderline', followersCount: 500_000 })
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [profile])
    const line = prompt.split('\n').find((l) => l.includes('@borderline')) ?? ''
    expect(line).not.toContain('[ESTABLISHED')
  })

  it('does NOT inject [ESTABLISHED] label for profiles under 500K followers', () => {
    const profile = makeProfile({ username: 'smallcreator', followersCount: 499_999 })
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [profile])
    const line = prompt.split('\n').find((l) => l.includes('@smallcreator')) ?? ''
    expect(line).not.toContain('[ESTABLISHED')
  })
})

describe('buildDiscoveryPrompt — account type string', () => {
  it('labels non-business accounts as "creator"', () => {
    const profile = makeProfile({ username: 'creator1', isBusinessAccount: false })
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [profile])
    const line = prompt.split('\n').find((l) => l.includes('@creator1')) ?? ''
    expect(line).toContain('type: creator')
    expect(line).not.toContain('type: business')
  })

  it('labels business accounts as "business"', () => {
    const profile = makeProfile({ username: 'biz1', isBusinessAccount: true })
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [profile])
    const line = prompt.split('\n').find((l) => l.includes('@biz1')) ?? ''
    expect(line).toContain('type: business')
    expect(line).not.toContain('type: creator')
  })
})

describe('buildDiscoveryPrompt — bio newline stripping', () => {
  it('replaces \\n in bio with space before injecting into prompt', () => {
    const profile = makeProfile({
      username: 'nluser',
      biography: 'Line one\nLine two',
    })
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [profile])
    // Raw newline must not appear inside the bio field
    const line = prompt.split('\n').find((l) => l.includes('@nluser')) ?? ''
    // The bio portion starts after bio: "
    expect(line).not.toContain('\n')
    expect(line).toContain('Line one Line two')
  })

  it('replaces \\r in bio with space', () => {
    const profile = makeProfile({
      username: 'cruser',
      biography: 'Part one\rPart two',
    })
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [profile])
    const line = prompt.split('\n').find((l) => l.includes('@cruser')) ?? ''
    expect(line).not.toContain('\r')
    expect(line).toContain('Part one Part two')
  })
})

describe('buildDiscoveryPrompt — city and niche injection', () => {
  it('includes the city name in the TASK line', () => {
    const prompt = buildDiscoveryPrompt('Bengaluru', 'fitness', [makeProfile()])
    expect(prompt).toContain('Bengaluru')
    expect(prompt).toContain('fitness')
  })

  it('includes city in locationConfidence instructions', () => {
    const prompt = buildDiscoveryPrompt('Delhi', 'travel', [makeProfile()])
    expect(prompt).toContain('"confirmed" if Delhi')
  })
})

describe('buildDiscoveryPrompt — structural requirements', () => {
  it('includes BALANCE RULE section', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [makeProfile()])
    expect(prompt).toContain('BALANCE RULE')
    expect(prompt).toContain('MINIMUM RESULT COUNT')
  })

  it('includes OUTPUT FORMAT section with required fields', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [makeProfile()])
    expect(prompt).toContain('"username"')
    expect(prompt).toContain('"category"')
    expect(prompt).toContain('"specialties"')
    expect(prompt).toContain('"contentFocus"')
    expect(prompt).toContain('"partnershipReady"')
    expect(prompt).toContain('"locationConfidence"')
  })

  it('includes CANDIDATE PROFILES section even with empty list', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [])
    expect(prompt).toContain('CANDIDATE PROFILES:')
  })

  it('includes correct JSON-only instruction', () => {
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [makeProfile()])
    expect(prompt).toContain('Return ONLY the JSON object')
  })
})

describe('buildDiscoveryPrompt — bio length clamping', () => {
  it('truncates bio to 150 chars in candidate summary', () => {
    const longBio = 'x'.repeat(200)
    const profile = makeProfile({ username: 'longbiouser', biography: longBio })
    const prompt = buildDiscoveryPrompt('Mumbai', 'food', [profile])
    const line = prompt.split('\n').find((l) => l.includes('@longbiouser')) ?? ''
    // The bio excerpt should be at most 150 'x' chars
    const match = line.match(/bio: "([^"]*)"/)
    expect(match).not.toBeNull()
    expect(match![1].length).toBeLessThanOrEqual(150)
  })
})
