import { describe, it, expect } from 'vitest'
import { verifyExtraction } from './verifyExtraction'

const CHUNKS = [
  { id: 'c1', text: 'Aman: We did forty lakh last quarter.\nVibhav: Across how many deals?' },
  { id: 'c2', text: 'Aman: Mostly Dubai visas and school admissions.' },
]
const ALLOWED = ['offer', 'audience', 'offLimits']

describe('verifyExtraction', () => {
  it('keeps a citation whose quote is verbatim in the cited chunk', () => {
    const r = verifyExtraction(
      [{ field_name: 'offer', value: 'Dubai visas', provenance: 'extracted', citations: [{ chunk_id: 'c2', quote: 'Mostly Dubai visas', start_sec: 5 }] }],
      CHUNKS, ALLOWED,
    )
    expect(r.droppedCitations).toBe(0)
    expect(r.fields[0].value).toBe('Dubai visas')
    expect(r.fields[0].citations).toHaveLength(1)
  })

  it('drops a paraphrased quote and nulls the value it was backing', () => {
    const r = verifyExtraction(
      [{ field_name: 'offer', value: 'Dubai visas', provenance: 'extracted', citations: [{ chunk_id: 'c2', quote: 'we mainly do visas for Dubai' }] }],
      CHUNKS, ALLOWED,
    )
    expect(r.droppedCitations).toBe(1)
    expect(r.forcedNull).toBe(1)
    // The claim survives only if something backs it.
    expect(r.fields[0].value).toBeNull()
  })

  it('drops a citation pointing at a chunk id we never sent', () => {
    const r = verifyExtraction(
      [{ field_name: 'offer', value: 'x', provenance: 'extracted', citations: [{ chunk_id: 'c999', quote: 'We did forty lakh last quarter.' }] }],
      CHUNKS, ALLOWED,
    )
    expect(r.droppedCitations).toBe(1)
    expect(r.fields[0].value).toBeNull()
  })

  it('ignores whitespace and case differences in an otherwise exact quote', () => {
    const r = verifyExtraction(
      [{ field_name: 'offer', value: 'x', provenance: 'extracted', citations: [{ chunk_id: 'c1', quote: '  we did   FORTY LAKH\n last quarter. ' }] }],
      CHUNKS, ALLOWED,
    )
    expect(r.droppedCitations).toBe(0)
    expect(r.fields[0].value).toBe('x')
  })

  it('keeps only the verifiable citations of a multi-source field', () => {
    const r = verifyExtraction(
      [{ field_name: 'audience', value: 'HNW families', provenance: 'extracted', citations: [
        { chunk_id: 'c1', quote: 'Across how many deals?' },
        { chunk_id: 'c2', quote: 'invented text that was never said' },
      ] }],
      CHUNKS, ALLOWED,
    )
    expect(r.droppedCitations).toBe(1)
    expect(r.forcedNull).toBe(0) // one good citation still backs the claim
    expect(r.fields[0].citations).toHaveLength(1)
  })

  it('does not require citations for a null value', () => {
    const r = verifyExtraction(
      [{ field_name: 'offLimits', value: null, provenance: 'extracted', citations: [] }],
      CHUNKS, ALLOWED,
    )
    expect(r.forcedNull).toBe(0)
    expect(r.fields[0].value).toBeNull()
  })

  it('rejects fields outside the allowed set, including handles', () => {
    const r = verifyExtraction(
      [
        { field_name: 'competitors.0', value: '@someone', provenance: 'extracted', citations: [] },
        { field_name: 'offer', value: null, provenance: 'extracted', citations: [] },
      ],
      CHUNKS, ALLOWED,
    )
    expect(r.rejectedFields).toBe(1)
    expect(r.fields.map((f) => f.field_name)).toEqual(['offer'])
  })

  it('gives inferred values a confidence and clamps it into range', () => {
    const r = verifyExtraction(
      [
        { field_name: 'audience', value: 'affluent NRIs', provenance: 'inferred', confidence: 1.8, citations: [] },
        { field_name: 'offer', value: 'x', provenance: 'inferred', citations: [{ chunk_id: 'c1', quote: 'Across how many deals?' }] },
      ],
      CHUNKS, ALLOWED,
    )
    expect(r.fields[0].confidence).toBe(1)
    expect(r.fields[1].confidence).toBe(0.5) // defaulted when the model omits it
    // inferred is our judgment, so it is not nulled for lacking a quote
    expect(r.fields[0].value).toBe('affluent NRIs')
  })

  it('survives malformed model output', () => {
    expect(verifyExtraction(null, CHUNKS, ALLOWED).fields).toEqual([])
    expect(verifyExtraction([{ nonsense: true }], CHUNKS, ALLOWED).fields).toEqual([])
  })
})
