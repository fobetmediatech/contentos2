import { describe, it, expect } from 'vitest'
import { parseContentStrategyDoc, buildContentStrategyPrompt } from './contentStrategy'
import type { StrategyBrief, AnalyzedAccount } from '../../domain/strategy'

const brief: StrategyBrief = {
  brandName: 'Ankur Sharma', primaryNiche: 'Real estate + Dubai', subNiche: 'Visas, schools',
  offer: 'Dubai relocation consultancy', language: 'hinglish', audience: 'HNIs worldwide',
  competitors: ['propertytalkswithad'], aspirational: ['rizwan.sajan'], brandColors: '',
  dislikes: 'no cringe videos', offLimits: 'nothing negative about Dubai',
  imageKeyword: 'Dubai skyline', theme: { preset: 'black-gold', accent: '', bg: '' },
}

describe('parseContentStrategyDoc', () => {
  it('returns safe empty defaults for junk input (never throws)', () => {
    const doc = parseContentStrategyDoc(null)
    expect(doc.positioning).toBe('')
    expect(doc.contentPillars).toEqual([])
    expect(doc.dos).toEqual([])
    expect(doc.cadence).toEqual({ postsPerWeek: '', notes: '' })
  })

  it('keeps valid fields and filters malformed array items', () => {
    const doc = parseContentStrategyDoc({
      positioning: 'Own the HNI-relocation niche',
      contentPillars: [{ name: 'Visas', description: 'visa explainers' }, 'bad', null],
      hookFormulas: [{ name: 'Myth', template: 'X is wrong because Y', example: 'Dubai tax myth' }],
      contentIdeas: [{ title: 'A', hook: 'h', format: 'Reel', pillar: 'Visas' }],
      cadence: { postsPerWeek: '4', notes: 'mornings' },
      dos: ['be specific', 42],
      donts: ['no cringe'],
    })
    expect(doc.positioning).toBe('Own the HNI-relocation niche')
    expect(doc.contentPillars).toHaveLength(1)
    expect(doc.cadence.postsPerWeek).toBe('4')
    expect(doc.dos).toEqual(['be specific'])
  })
})

describe('buildContentStrategyPrompt', () => {
  it('injects the offer, language rule, and off-limits constraint', () => {
    const accounts: AnalyzedAccount[] = [
      { username: 'propertytalkswithad', fullName: 'Akash', followers: 50000, engagementRate: 3.2, verified: false, source: 'competitor', profilePicUrl: '' },
    ]
    const prompt = buildContentStrategyPrompt(brief, accounts, [])
    expect(prompt).toContain('Dubai relocation consultancy')
    expect(prompt).toContain('LATIN script') // hinglish rule
    expect(prompt).toContain('nothing negative about Dubai')
    expect(prompt).toContain('@propertytalkswithad')
  })
})
