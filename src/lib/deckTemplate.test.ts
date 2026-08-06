import { describe, it, expect } from 'vitest'
import { SLOTS, AI_SLOTS, fillDeck, slotsFromBrief, rawTemplate, slotPattern, type SlotKey } from './deckTemplate'
import { SAMPLE_RESULT } from './sampleStrategy'

const NOW = new Date('2026-08-04T12:00:00Z')

describe('deck template slots', () => {
  // The whole scheme rests on this: slots key off placeholder TEXT, so a duplicate would fill the
  // wrong span silently. This is the guard that makes editing the .html safe.
  it('every mapped placeholder occurs exactly once in the template', () => {
    const html = rawTemplate()
    const duplicated = (Object.entries(SLOTS) as Array<[SlotKey, string]>)
      .map(([key, text]) => [key, (html.match(slotPattern(text)) ?? []).length] as const)
      .filter(([, count]) => count !== 1)
    expect(duplicated, 'placeholders that are missing or appear more than once').toEqual([])
  })

  it('the cover headline placeholder exists', () => {
    expect(rawTemplate()).toContain('[Client Name]')
  })
})

describe('fillDeck', () => {
  it('replaces a filled slot and drops the blank styling', () => {
    const html = fillDeck({ highestMarginOffer: 'Dubai relocation' })
    expect(html).toContain('<strong>Dubai relocation</strong>')
    expect(html).not.toContain('<span class="fill">offer</span>')
  })

  it('leaves unfilled slots as visible blanks', () => {
    // An empty blank is how a reviewer sees what is still missing — never fill it with a guess.
    const html = fillDeck({})
    expect(html).toContain('<span class="fill">the gap</span>')
  })

  it('escapes HTML in values', () => {
    const html = fillDeck({ theGap: '<img onerror=alert(1)>' })
    expect(html).toContain('&lt;img onerror=alert(1)&gt;')
    expect(html).not.toContain('<img onerror')
  })

  it('fills the cover headline from the client name', () => {
    expect(fillDeck({ preparedFor: 'Ankur Sharma' })).not.toContain('[Client Name]')
  })

  it('ignores blank and whitespace-only values', () => {
    expect(fillDeck({ theGap: '   ' })).toContain('<span class="fill">the gap</span>')
  })
})

describe('slotsFromBrief', () => {
  it('sources everything it can without the model', () => {
    const s = slotsFromBrief(SAMPLE_RESULT.brief, NOW)
    expect(s.preparedFor).toBe('Ankur Sharma')
    expect(s.highestMarginOffer).toBe(SAMPLE_RESULT.brief.offer)
    expect(s.language).toBe('hinglish')
    expect(s.monthYear).toBe('AUGUST 2026')
  })

  it('omits slots the brief has no value for, rather than emitting empties', () => {
    const s = slotsFromBrief({ ...SAMPLE_RESULT.brief, offer: '', primaryNiche: '' }, NOW)
    expect(s.highestMarginOffer).toBeUndefined()
    expect(s.category).toBeUndefined()
  })

  it('leaves every AI slot to the model', () => {
    const s = slotsFromBrief(SAMPLE_RESULT.brief, NOW)
    for (const key of AI_SLOTS) expect(s[key]).toBeUndefined()
  })
})
