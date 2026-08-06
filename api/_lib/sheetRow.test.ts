import { describe, it, expect } from 'vitest'
import { mapSheetRow, normaliseHandle } from './sheetRow'

describe('normaliseHandle', () => {
  it('strips @ and whitespace', () => {
    expect(normaliseHandle('  @dubai_homes ')).toBe('dubai_homes')
  })
  it('extracts the handle from a profile URL', () => {
    expect(normaliseHandle('https://instagram.com/dubai_homes/')).toBe('dubai_homes')
    expect(normaliseHandle('instagram.com/dubai_homes?hl=en')).toBe('dubai_homes')
  })
  it('leaves a bare handle alone and returns empty for blanks', () => {
    expect(normaliseHandle('dubai_homes')).toBe('dubai_homes')
    expect(normaliseHandle('   ')).toBe('')
  })
})

describe('mapSheetRow', () => {
  it('maps scalar fields with sheet provenance and no citations', () => {
    const r = mapSheetRow({ fields: { offer: ' Dubai visas ', audience: 'HNW families' } })
    expect(r.rows).toEqual([
      { field_name: 'offer', value: 'Dubai visas', provenance: 'sheet', citations: [] },
      { field_name: 'audience', value: 'HNW families', provenance: 'sheet', citations: [] },
    ])
  })

  it('skips blank and non-string scalars rather than storing empties', () => {
    const r = mapSheetRow({ fields: { offer: '   ', audience: undefined } })
    expect(r.rows).toEqual([])
  })

  it('packs handles into positional slots', () => {
    const r = mapSheetRow({ competitors: ['@a', 'b'], aspirational: ['@c'] })
    expect(r.rows.map((x) => x.field_name)).toEqual([
      'competitors.0', 'competitors.1', 'aspirational.0',
    ])
    expect(r.rows.map((x) => x.value)).toEqual(['a', 'b', 'c'])
  })

  it('drops and REPORTS handles beyond the fixed slot count', () => {
    const r = mapSheetRow({
      competitors: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
      aspirational: ['a1', 'a2', 'a3', 'a4', 'a5'],
    })
    expect(r.rows.filter((x) => x.field_name.startsWith('competitors')).length).toBe(5)
    expect(r.rows.filter((x) => x.field_name.startsWith('aspirational')).length).toBe(4)
    // Never silently truncated — the caller must be able to warn.
    expect(r.droppedCompetitors).toEqual(['c6', 'c7'])
    expect(r.droppedAspirational).toEqual(['a5'])
  })

  it('de-dupes handles case-insensitively so one account cannot burn two slots', () => {
    const r = mapSheetRow({ competitors: ['@Dubai_Homes', 'dubai_homes', 'other'] })
    expect(r.rows.map((x) => x.value)).toEqual(['Dubai_Homes', 'other'])
  })

  it('normalises and de-dupes emails', () => {
    const r = mapSheetRow({ emails: [' Aman@Example.COM ', 'aman@example.com', 'not-an-email'] })
    expect(r.emails).toEqual(['aman@example.com'])
  })

  it('every produced row is sheet-provenance — the model never authors these', () => {
    const r = mapSheetRow({ competitors: ['a'], fields: { offer: 'x' } })
    expect(r.rows.every((x) => x.provenance === 'sheet')).toBe(true)
    expect(r.rows.every((x) => x.citations.length === 0)).toBe(true)
  })

  it('survives an empty row', () => {
    const r = mapSheetRow({})
    expect(r).toEqual({ rows: [], emails: [], droppedCompetitors: [], droppedAspirational: [] })
  })
})
