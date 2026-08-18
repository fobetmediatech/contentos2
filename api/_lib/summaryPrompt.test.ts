import { describe, it, expect } from 'vitest'
import { buildSummaryPrompt, normaliseSummary } from './summaryPrompt.js'

describe('buildSummaryPrompt', () => {
  it('includes the title and the transcript', () => {
    const out = buildSummaryPrompt('Onboarding Call - Abhijeet', 'Speaker A: hello')
    expect(out).toContain('Onboarding Call - Abhijeet')
    expect(out).toContain('Speaker A: hello')
  })

  it('survives a null title', () => {
    expect(buildSummaryPrompt(null, 'text')).toContain('text')
  })

  // A 60-minute call is well within the model's context, but an unbounded slice is how a runaway
  // row turns one request into a timeout.
  it('caps the transcript length', () => {
    const out = buildSummaryPrompt(null, 'x'.repeat(300_000))
    expect(out.length).toBeLessThan(220_000)
  })
})

describe('normaliseSummary', () => {
  it('returns empty sections for junk input', () => {
    expect(normaliseSummary(null)).toEqual({ discussion: [], decisions: [], actionItems: [], keyNumbers: [] })
    expect(normaliseSummary('nope')).toEqual({ discussion: [], decisions: [], actionItems: [], keyNumbers: [] })
  })

  it('keeps well-formed entries', () => {
    const out = normaliseSummary({
      discussion: [{ text: 'Budget discussed', timestamp: '4:12' }],
      decisions: [{ text: 'Go with plan B', timestamp: '18:00' }],
      action_items: [{ text: 'Send the deck', owner: 'Aditya', timestamp: '55:30' }],
      key_numbers: [{ label: 'Monthly retainer', value: '80,000', timestamp: '21:05' }],
    })
    expect(out.discussion).toEqual([{ text: 'Budget discussed', timestamp: '4:12' }])
    expect(out.decisions).toEqual([{ text: 'Go with plan B', timestamp: '18:00' }])
    expect(out.actionItems).toEqual([{ text: 'Send the deck', owner: 'Aditya', timestamp: '55:30' }])
    expect(out.keyNumbers).toEqual([{ label: 'Monthly retainer', value: '80,000', timestamp: '21:05' }])
  })

  it('drops entries with no text and defaults a missing owner to null', () => {
    const out = normaliseSummary({
      discussion: [{ text: '', timestamp: '1:00' }, { text: 'Kept', timestamp: '2:00' }],
      action_items: [{ text: 'No owner named', timestamp: '3:00' }],
    })
    expect(out.discussion).toEqual([{ text: 'Kept', timestamp: '2:00' }])
    expect(out.actionItems).toEqual([{ text: 'No owner named', owner: null, timestamp: '3:00' }])
  })

  it('defaults a missing timestamp to an empty string rather than inventing one', () => {
    const out = normaliseSummary({ decisions: [{ text: 'Agreed' }] })
    expect(out.decisions).toEqual([{ text: 'Agreed', timestamp: '' }])
  })

  // A key number with no figure is not a key number — it would print as "Monthly retainer: " on a
  // document that gets sent to a client.
  it('drops a key number missing either half, keeps a complete one', () => {
    const out = normaliseSummary({
      key_numbers: [
        { label: 'Monthly retainer', timestamp: '1:00' },
        { value: '80,000', timestamp: '2:00' },
        { label: 'Ticket size', value: '2.5L', timestamp: '3:00' },
      ],
    })
    expect(out.keyNumbers).toEqual([{ label: 'Ticket size', value: '2.5L', timestamp: '3:00' }])
  })
})
