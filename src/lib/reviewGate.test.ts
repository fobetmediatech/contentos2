import { describe, it, expect } from 'vitest'
import { buildBriefFromExtractions, evaluateGate, approvableRows, type ExtractionRow } from './reviewGate'

const row = (p: Partial<ExtractionRow> & { fieldName: string }): ExtractionRow => ({
  id: p.fieldName,
  value: null,
  citations: [],
  provenance: 'extracted',
  confidence: null,
  reviewStatus: 'pending',
  originalValue: null,
  ...p,
})

/** The minimum that clears every gate. */
const passing = (): ExtractionRow[] => [
  row({ fieldName: 'brandName', value: 'Abhijeet MAS' }),
  row({ fieldName: 'offer', value: 'Dubai relocation' }),
  row({ fieldName: 'competitors.0', value: 'dubai_homes', provenance: 'sheet' }),
]

describe('buildBriefFromExtractions', () => {
  it('produces a complete brief shape even from nothing', () => {
    const b = buildBriefFromExtractions([])
    expect(b.competitors).toHaveLength(5)
    expect(b.aspirational).toHaveLength(4)
    expect(b.language).toBe('hinglish') // EMPTY_BRIEF default survives
  })

  it('maps positional handles into the right slots', () => {
    const b = buildBriefFromExtractions([
      row({ fieldName: 'competitors.2', value: 'third', provenance: 'sheet' }),
      row({ fieldName: 'aspirational.0', value: 'first', provenance: 'sheet' }),
    ])
    expect(b.competitors[2]).toBe('third')
    expect(b.competitors[0]).toBe('')
    expect(b.aspirational[0]).toBe('first')
  })

  it('ignores out-of-range slots and unknown fields instead of guessing', () => {
    const b = buildBriefFromExtractions([
      row({ fieldName: 'competitors.9', value: 'nope', provenance: 'sheet' }),
      row({ fieldName: 'somethingNew', value: 'nope' }),
    ])
    expect(b.competitors.every((c) => c === '')).toBe(true)
  })

  it('only accepts a valid language enum', () => {
    expect(buildBriefFromExtractions([row({ fieldName: 'language', value: 'english' })]).language).toBe('english')
    expect(buildBriefFromExtractions([row({ fieldName: 'language', value: 'klingon' })]).language).toBe('hinglish')
  })

  it('treats a rejected value as absent', () => {
    const b = buildBriefFromExtractions([
      row({ fieldName: 'offer', value: 'wrong thing', reviewStatus: 'rejected' }),
    ])
    expect(b.offer).toBe('')
  })

  it('does not mutate EMPTY_BRIEF across calls', () => {
    buildBriefFromExtractions([row({ fieldName: 'competitors.0', value: 'x', provenance: 'sheet' })])
    expect(buildBriefFromExtractions([]).competitors[0]).toBe('')
  })
})

describe('evaluateGate', () => {
  it('passes on the minimum viable brief', () => {
    expect(evaluateGate(passing()).blocked).toBe(false)
  })

  it('blocks when a required field is empty', () => {
    const rows = passing().filter((r) => r.fieldName !== 'offer')
    const g = evaluateGate(rows)
    expect(g.blocked).toBe(true)
    expect(g.blockers.find((b) => b.code === 'missing_required')?.fields).toEqual(['offer'])
  })

  it("blocks with NO handles — the pipeline gate the form's own button misses", () => {
    const rows = passing().filter((r) => !r.fieldName.startsWith('competitors'))
    const g = evaluateGate(rows)
    expect(g.blocked).toBe(true)
    expect(g.blockers.some((b) => b.code === 'no_handles')).toBe(true)
  })

  it('accepts an aspirational handle alone', () => {
    const rows = [
      ...passing().filter((r) => !r.fieldName.startsWith('competitors')),
      row({ fieldName: 'aspirational.0', value: 'big_creator', provenance: 'sheet' }),
    ]
    expect(evaluateGate(rows).blocked).toBe(false)
  })

  it('blocks on unreviewed inferred values, and clears once approved', () => {
    const withInferred = [
      ...passing(),
      row({ fieldName: 'audience', value: 'affluent NRIs', provenance: 'inferred', confidence: 0.6 }),
    ]
    expect(evaluateGate(withInferred).blocked).toBe(true)

    const approved = withInferred.map((r) =>
      r.provenance === 'inferred' ? { ...r, reviewStatus: 'approved' as const } : r,
    )
    expect(evaluateGate(approved).blocked).toBe(false)
  })

  it('does not block on an inferred value that is empty', () => {
    const rows = [...passing(), row({ fieldName: 'audience', value: null, provenance: 'inferred' })]
    expect(evaluateGate(rows).blocked).toBe(false)
  })
})

describe('approvableRows', () => {
  it('covers extracted and sheet, never inferred', () => {
    const rows = [
      row({ fieldName: 'offer', value: 'x' }),
      row({ fieldName: 'competitors.0', value: 'y', provenance: 'sheet' }),
      row({ fieldName: 'audience', value: 'z', provenance: 'inferred' }),
      row({ fieldName: 'subNiche', value: null }),
      row({ fieldName: 'dislikes', value: 'w', reviewStatus: 'approved' }),
    ]
    expect(approvableRows(rows).map((r) => r.fieldName)).toEqual(['offer', 'competitors.0'])
  })
})
