import { describe, it, expect } from 'vitest'
import { buildBriefPrompt, normaliseBrief } from './briefPrompt.js'

describe('buildBriefPrompt', () => {
  it('includes the title and the transcript', () => {
    const out = buildBriefPrompt('Discovery Call - Tahir', 'Speaker A: I want awareness')
    expect(out).toContain('Discovery Call - Tahir')
    expect(out).toContain('I want awareness')
  })

  it('survives a null title', () => {
    expect(buildBriefPrompt(null, 'text')).toContain('text')
  })

  it('caps the transcript length', () => {
    const out = buildBriefPrompt(null, 'x'.repeat(300_000))
    expect(out.length).toBeLessThan(220_000)
  })
})

const EMPTY = {
  clientName: '',
  clientNiche: '',
  goals: [],
  contentDirection: [],
  audienceGeography: '',
  audienceProfile: '',
  creatorsAdmired: [],
  otherNotes: [],
}

describe('normaliseBrief', () => {
  it('returns a blank brief for junk input', () => {
    expect(normaliseBrief(null)).toEqual(EMPTY)
    expect(normaliseBrief('nope')).toEqual(EMPTY)
  })

  it('keeps well-formed fields and preserves the assumed flag', () => {
    const out = normaliseBrief({
      client_name: 'Tahir',
      client_niche: 'Trading & Brokerage',
      goals: [{ text: 'Build awareness', assumed: false }],
      creators_admired: [{ text: 'Established brokerage leaders', assumed: true }],
      audience_geography: '90% India',
    })
    expect(out.clientName).toBe('Tahir')
    expect(out.clientNiche).toBe('Trading & Brokerage')
    expect(out.goals).toEqual([{ text: 'Build awareness', assumed: false }])
    expect(out.creatorsAdmired).toEqual([{ text: 'Established brokerage leaders', assumed: true }])
    expect(out.audienceGeography).toBe('90% India')
  })

  it('drops items with no text and defaults a missing assumed flag to false', () => {
    const out = normaliseBrief({
      goals: [{ text: '', assumed: true }, { text: 'Kept' }],
    })
    expect(out.goals).toEqual([{ text: 'Kept', assumed: false }])
  })

  // The response schema is snake_case, but a defensive re-normalise of an already-normalised
  // (camelCase) object must be a no-op — same round-trip guard as normaliseSummary.
  it('is idempotent across a store-and-reload round trip', () => {
    const fresh = normaliseBrief({
      client_name: 'Tahir',
      goals: [{ text: 'Awareness', assumed: false }],
      creators_admired: [{ text: 'Someone', assumed: true }],
    })
    const reloaded = normaliseBrief(JSON.parse(JSON.stringify(fresh)))
    expect(reloaded).toEqual(fresh)
  })
})
