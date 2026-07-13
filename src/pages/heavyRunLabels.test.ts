import { describe, it, expect } from 'vitest'
import { competitorRunLabel, discoveryRunLabel, repurposeRunLabel, reelRunLabel } from './heavyRunLabels'

describe('heavyRunLabels', () => {
  it('competitor: clarifying shows a wait message; running shows step detail', () => {
    expect(competitorRunLabel('clarifying', 5, '')).toMatch(/answer/i)
    expect(competitorRunLabel('running', 3, 'Found 47 accounts')).toMatch(/47/)
    expect(competitorRunLabel('running', 3, '')).toMatch(/./) // non-empty step label fallback
  })
  it('discovery: uses step detail then step label', () => {
    expect(discoveryRunLabel(2, 'Scraping posts…')).toMatch(/Scraping/)
    expect(discoveryRunLabel(1, null)).toMatch(/./)
  })
  it('repurpose: maps each stage to a label', () => {
    expect(repurposeRunLabel('building-profile')).toMatch(/./)
    expect(repurposeRunLabel('rewriting')).toMatch(/./)
  })
  it('reel: summarizes creator progress', () => {
    const cs = { a: { status: 'done' }, b: { status: 'analyzing' }, c: { status: 'scraping' } } as never
    expect(reelRunLabel(cs, 'running')).toMatch(/3/) // mentions the 3 creators / progress
    expect(reelRunLabel({} as never, 'running')).toMatch(/./)
  })
})
