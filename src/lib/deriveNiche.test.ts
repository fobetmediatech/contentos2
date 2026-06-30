import { describe, it, expect } from 'vitest'
import { deriveNicheFromProfiles } from './deriveNiche'
import type { NormalizedProfile } from './transformers'

function makeProfile(over: Partial<NormalizedProfile> = {}): NormalizedProfile {
  return {
    username: 'themoneylancer',
    fullName: 'The Money Lancer',
    biography: '',
    followersCount: 40_000,
    followsCount: 200,
    postsCount: 300,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 500,
    avgComments: 20,
    engagementRate: 1.3,
    relatedHandles: [],
    topHashtags: [],
    ...over,
  }
}

describe('deriveNicheFromProfiles — web-search fallback niche', () => {
  it('prefers top hashtags (the strongest niche signal) when present', () => {
    const out = deriveNicheFromProfiles([makeProfile({ topHashtags: ['personalfinance', 'moneytips', 'investing', 'freelance', 'extra'] })])
    // Joins the leading hashtags into a niche query (cap a few; no # symbols).
    expect(out.toLowerCase()).toContain('personalfinance')
    expect(out.toLowerCase()).toContain('moneytips')
    expect(out).not.toContain('#')
  })

  it('falls back to businessCategoryName when there are no hashtags', () => {
    const out = deriveNicheFromProfiles([makeProfile({ topHashtags: [], businessCategoryName: 'Personal finance' })])
    expect(out).toBe('Personal finance')
  })

  it('falls back to biography words when neither hashtags nor category exist', () => {
    const out = deriveNicheFromProfiles([makeProfile({ topHashtags: [], biography: 'Helping freelancers manage money and taxes\nDM for coaching' })])
    expect(out.toLowerCase()).toContain('freelancers')
    expect(out).not.toContain('\n')
  })

  it('falls back to fullName when there is no other signal', () => {
    expect(deriveNicheFromProfiles([makeProfile({ topHashtags: [], biography: '', businessCategoryName: '' })])).toBe('The Money Lancer')
  })

  it('aggregates hashtags across multiple reference profiles', () => {
    const out = deriveNicheFromProfiles([
      makeProfile({ topHashtags: ['fitness', 'gym'] }),
      makeProfile({ username: 'b', topHashtags: ['calisthenics', 'fitness'] }),
    ])
    expect(out.toLowerCase()).toContain('fitness')
    expect(out.toLowerCase()).toContain('calisthenics')
  })

  it('returns empty string for no profiles or a fully blank profile', () => {
    expect(deriveNicheFromProfiles([])).toBe('')
    expect(deriveNicheFromProfiles([makeProfile({ fullName: '', biography: '', businessCategoryName: '', topHashtags: [] })])).toBe('')
  })

  it('never returns an unbounded string', () => {
    const out = deriveNicheFromProfiles([makeProfile({ topHashtags: [], biography: 'x'.repeat(500) })])
    expect(out.length).toBeLessThanOrEqual(80)
  })
})
