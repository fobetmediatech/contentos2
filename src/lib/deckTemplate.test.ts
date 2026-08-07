import { describe, it, expect } from 'vitest'
import { SLOTS, AI_SLOTS, fillDeck, slotsFromBrief, rawTemplate, slotPattern, fillCompetitorTable, type SlotKey } from './deckTemplate'
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

describe('fillCompetitorTable', () => {
  const rows = [
    { username: 'thealphatraderofficial', followers: 128000, medianViews: 42000, engagementRate: 4.2, formats: ['Bold market claim', 'Direct question'] },
    { username: 'the_real_sourabh', followers: 76500, medianViews: null, engagementRate: null, formats: [] },
  ]

  it('replaces the hardcoded placeholder rows', () => {
    const html = fillCompetitorTable(rawTemplate(), rows)
    expect(html).not.toContain('@competitor_1')
    expect(html).toContain('@thealphatraderofficial')
    expect(html).toContain('128K')
    expect(html).toContain('42K')
    expect(html).toContain('4.2% ER')
  })

  it('relabels the header, because the number is a median not a mean', () => {
    const html = fillCompetitorTable(rawTemplate(), rows)
    expect(html).toContain('<th>Median views</th>')
    expect(html).not.toContain('<th>Avg views</th>')
  })

  it('leaves columns we cannot measure as visible blanks, never invented values', () => {
    // Posts/week is not measured and "what they are missing" is a judgment nobody has made.
    // A plausible guess here would put fabricated numbers in front of a client.
    const html = fillCompetitorTable(rawTemplate(), rows)
    expect(html).toContain('<span class="fill">n</span>')
    expect(html).toContain('<span class="fill">the gap</span>')
  })

  it('shows a blank rather than a zero when an account had no reels analysed', () => {
    const html = fillCompetitorTable(rawTemplate(), rows)
    expect(html).toContain('no reels analysed')
  })

  it('names the analysed accounts in the screenshot placeholders', () => {
    const html = fillCompetitorTable(rawTemplate(), rows)
    expect(html).toContain('@thealphatraderofficial<br>top reel')
    // Only 2 rows supplied, so placeholders 3 and 4 keep their generic label.
    expect(html).toContain('@competitor_3')
  })

  it('leaves the template untouched when there is nothing to show', () => {
    expect(fillCompetitorTable(rawTemplate(), [])).toBe(rawTemplate())
  })

  it('escapes a handle rather than trusting it as markup', () => {
    const html = fillCompetitorTable(rawTemplate(), [{ ...rows[0], username: 'a<img>b' }])
    expect(html).toContain('a&lt;img&gt;b')
    expect(html).not.toContain('<img>')
  })
})
