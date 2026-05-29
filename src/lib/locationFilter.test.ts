import { describe, it, expect } from 'vitest'
import { filterByLocation } from './locationFilter'
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

describe('filterByLocation — creator accounts', () => {
  it('passes creator with target city in bio', () => {
    const profile = makeProfile({ biography: 'Food vlogger from Indore 🍛' })
    const { filtered } = filterByLocation([profile], 'Indore')
    expect(filtered).toHaveLength(1)
  })

  it('passes creator with NO city signal (assumed local)', () => {
    const profile = makeProfile({ biography: 'Food lover | daily eats' })
    const { filtered } = filterByLocation([profile], 'Indore')
    expect(filtered).toHaveLength(1)
  })

  it('rejects creator whose bio names a DIFFERENT city', () => {
    const profile = makeProfile({ biography: 'Mumbai food blogger 🍜' })
    const { passedCount } = filterByLocation([profile], 'Indore')
    // relaxation fires (passedCount < 15), so filtered returns all
    // but passedCount should be 0 (the profile failed strict filter)
    expect(passedCount).toBe(0)
  })

  it('passes creator whose bio has the city alias', () => {
    const profile = makeProfile({ biography: 'Born in Bombay, eating everywhere' })
    const { filtered } = filterByLocation([profile], 'Mumbai')
    expect(filtered).toHaveLength(1)
  })

  it('rejects creator with Delhi in bio when searching Mumbai', () => {
    const profile = makeProfile({ biography: 'Delhi food vlogger 🍢' })
    const { passedCount } = filterByLocation([profile], 'Mumbai')
    expect(passedCount).toBe(0)
  })
})

describe('filterByLocation — business accounts', () => {
  it('passes business with city in bio', () => {
    const profile = makeProfile({
      biography: 'Best restaurant in Indore',
      isBusinessAccount: true,
    })
    const { filtered } = filterByLocation([profile], 'Indore')
    expect(filtered).toHaveLength(1)
  })

  it('rejects business with no city signal', () => {
    const profile = makeProfile({
      biography: 'Best food in town',
      isBusinessAccount: true,
    })
    const { passedCount } = filterByLocation([profile], 'Indore')
    expect(passedCount).toBe(0)
  })

  it('passes business with city in businessAddress', () => {
    const profile = makeProfile({
      biography: 'Best food in town',
      isBusinessAccount: true,
      // duck-typed extension
      ...({ businessAddress: '45 MG Road, Indore, MP' } as object),
    } as NormalizedProfile)
    const { filtered } = filterByLocation([profile], 'Indore')
    expect(filtered).toHaveLength(1)
  })

  it('rejects business with a different city in bio', () => {
    const profile = makeProfile({
      biography: 'Mumbai street food',
      isBusinessAccount: true,
    })
    const { passedCount } = filterByLocation([profile], 'Indore')
    expect(passedCount).toBe(0)
  })
})

describe('filterByLocation — relaxation rule', () => {
  it('relaxes when fewer than 15 profiles pass (returns all candidates)', () => {
    const profiles = [
      makeProfile({ biography: 'Indore foodie', username: 'a' }),
      makeProfile({ biography: 'No city signal', username: 'b', isBusinessAccount: true }),
    ]
    const { relaxed, filtered } = filterByLocation(profiles, 'Indore')
    expect(relaxed).toBe(true)
    // all profiles returned because passedCount < 15
    expect(filtered.length).toBeGreaterThanOrEqual(profiles.length)
  })

  it('does not relax when 15+ profiles pass', () => {
    const profiles = Array.from({ length: 16 }, (_, i) =>
      makeProfile({ biography: 'Indore food blogger', username: `user${i}` }),
    )
    const { relaxed, passedCount } = filterByLocation(profiles, 'Indore')
    expect(relaxed).toBe(false)
    expect(passedCount).toBe(16)
  })
})

describe('filterByLocation — city aliases', () => {
  it('recognises Bangalore as alias for Bengaluru', () => {
    const profile = makeProfile({ biography: 'Bengaluru food enthusiast' })
    const { filtered } = filterByLocation([profile], 'Bangalore')
    expect(filtered).toHaveLength(1)
  })

  it('recognises NCR as alias for Delhi', () => {
    const profile = makeProfile({ biography: 'NCR food scene' })
    const { filtered } = filterByLocation([profile], 'Delhi')
    expect(filtered).toHaveLength(1)
  })
})
