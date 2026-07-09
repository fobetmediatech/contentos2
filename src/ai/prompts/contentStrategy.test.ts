import { describe, it, expect } from 'vitest'
import { parseContentStrategyDoc, buildContentStrategyPrompt } from './contentStrategy'
import type { StrategyBrief, AnalyzedAccount } from '../../domain/strategy'

const brief: StrategyBrief = {
  brandName: 'Ankur Sharma', primaryNiche: 'Real estate + Dubai', subNiche: 'Visas, schools',
  offer: 'Dubai relocation consultancy', language: 'hinglish', audience: 'HNIs worldwide',
  competitors: ['propertytalkswithad'], aspirational: ['rizwan.sajan'], brandColors: '',
  dislikes: 'no cringe videos', offLimits: 'nothing negative about Dubai',
  theme: { preset: 'black-gold', accent: '', bg: '' },
}

describe('parseContentStrategyDoc', () => {
  it('returns safe empty defaults for junk input (never throws)', () => {
    const doc = parseContentStrategyDoc(null)
    expect(doc.positioning).toBe('')
    expect(doc.contentPillars).toEqual([])
    expect(doc.dos).toEqual([])
    expect(doc.cadence).toEqual({ postsPerWeek: '', notes: '' })
    expect(doc.categoryTension).toEqual({ headline: '', bullets: [] })
    expect(doc.kpiFramework).toEqual({ leading: [], mid: [], lag: [] })
    expect(doc.commercials).toEqual({ monthlyRetainer: '', lineItems: [], longTermValue: [] })
  })

  it('keeps valid fields and filters malformed array items', () => {
    const doc = parseContentStrategyDoc({
      positioning: 'Own the HNI-relocation niche',
      contentPillars: [{ name: 'Visas', description: 'visa explainers' }, 'bad', null],
      hookFormulas: [{ name: 'Myth', template: 'X is wrong because Y', example: 'Dubai tax myth' }],
      contentIdeas: [{ title: 'A', hook: 'h', format: 'Reel', pillar: 'Visas' }],
      cadence: { postsPerWeek: '4', notes: 'mornings' },
      categoryTension: { headline: 'Trust gap', bullets: ['fear beats greed', 99] },
      benchmarks: [{ name: 'Groww', metric: '1M+', lesson: 'build education lanes' }],
      heroHubHygiene: [{ name: 'Hero', role: 'WHAT', description: 'big narrative', examples: ['myth'] }],
      kpiFramework: { leading: ['reach'], mid: ['DMs'], lag: ['search'] },
      commercials: { monthlyRetainer: 'TBD', lineItems: [{ label: 'Strategy', amount: 'TBD' }], longTermValue: ['content library'] },
      dos: ['be specific', 42],
      donts: ['no cringe'],
    })
    expect(doc.positioning).toBe('Own the HNI-relocation niche')
    expect(doc.contentPillars).toHaveLength(1)
    expect(doc.cadence.postsPerWeek).toBe('4')
    expect(doc.categoryTension.bullets).toEqual(['fear beats greed'])
    expect(doc.benchmarks[0]?.lesson).toBe('build education lanes')
    expect(doc.kpiFramework.mid).toEqual(['DMs'])
    expect(doc.commercials.monthlyRetainer).toBe('TBD')
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
