import { describe, it, expect } from 'vitest'
import { planQuery, parseDate, relevantChunks, MIN_SIMILARITY, type RetrievedChunk } from './askQuery'

const NOW = new Date('2026-08-04T12:00:00Z')

describe('parseDate', () => {
  it('parses "Oct 12" and "12 Oct" to the same UTC day', () => {
    const a = parseDate('the Oct 12 call', 2026)!
    const b = parseDate('the 12 Oct call', 2026)!
    expect(a.from).toBe(b.from)
    expect(a.from).toBe('2026-10-12T00:00:00.000Z')
    expect(a.to).toBe('2026-10-13T00:00:00.000Z')
  })

  it('parses long month names with ordinals', () => {
    expect(parseDate('October 12th', 2026)!.from).toBe('2026-10-12T00:00:00.000Z')
  })

  it('parses ISO dates', () => {
    expect(parseDate('on 2026-08-04', 2026)!.from).toBe('2026-08-04T00:00:00.000Z')
  })

  it('refuses vague time language rather than guessing a range', () => {
    // Silently narrowing to a guessed window would drop relevant material invisibly.
    expect(parseDate('recently', 2026)).toBeNull()
    expect(parseDate('last month', 2026)).toBeNull()
    expect(parseDate('what did they say about budget', 2026)).toBeNull()
  })

  it('rejects impossible days', () => {
    expect(parseDate('Oct 99', 2026)).toBeNull()
  })
})

describe('planQuery', () => {
  it('routes a dated meeting question to metadata', () => {
    const p = planQuery('what happened in the Oct 12 onboarding call', NOW)
    expect(p.mode).toBe('metadata')
    expect(p.meetingType).toBe('onboarding')
    expect(p.dateFrom).toBe('2026-10-12T00:00:00.000Z')
  })

  it('routes "what happened in the onboarding call" to metadata without a date', () => {
    expect(planQuery('what happened in the onboarding call', NOW).mode).toBe('metadata')
  })

  it('routes a topic question to semantic', () => {
    const p = planQuery('what did they say about their margins', NOW)
    expect(p.mode).toBe('semantic')
    expect(p.dateFrom).toBeNull()
  })

  it('keeps a topic question semantic even when it names a meeting type', () => {
    // The user wants part of that meeting, not a recap of the whole thing.
    const p = planQuery('what did they say about budget in the onboarding call', NOW)
    expect(p.mode).toBe('semantic')
    expect(p.meetingType).toBe('onboarding') // still narrows the search
  })

  it('detects sales/discovery calls', () => {
    expect(planQuery('summarise the discovery call', NOW).meetingType).toBe('sales')
  })

  it('leaves a cross-client question semantic and unfiltered', () => {
    const p = planQuery('which clients mentioned RERA constraints', NOW)
    expect(p.mode).toBe('semantic')
    expect(p.meetingType).toBeNull()
    expect(p.dateFrom).toBeNull()
  })
})

describe('relevantChunks', () => {
  const chunk = (similarity: number): RetrievedChunk => ({
    chunk_id: 'c', chunk_text: 't', speaker: null, start_sec: null,
    similarity, title: null, meeting_date: null, client_id: null,
  })

  it('drops weak matches so nothing is answered from marginal text', () => {
    const out = relevantChunks([chunk(0.9), chunk(MIN_SIMILARITY - 0.01), chunk(0.5)])
    expect(out).toHaveLength(2)
  })

  it('returns empty when everything is weak — the caller must then say so', () => {
    expect(relevantChunks([chunk(0.1), chunk(0.2)])).toEqual([])
  })

  it('keeps a chunk exactly at the threshold', () => {
    expect(relevantChunks([chunk(MIN_SIMILARITY)])).toHaveLength(1)
  })
})
