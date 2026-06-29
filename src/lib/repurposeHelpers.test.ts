import { describe, it, expect } from 'vitest'
import { pickExemplars, prepareScriptCorpus, scriptsProfileKey } from './repurposeHelpers'

describe('pickExemplars (few-shot fuel for the rewrite)', () => {
  it('takes the first 1-2 sentences of each sample as a verbatim exemplar', () => {
    const ex = pickExemplars(['Stop scrolling. This changed my life. Then more text here.', 'Hey guys welcome back!'])
    expect(ex[0]).toBe('Stop scrolling. This changed my life.')
    expect(ex[1]).toBe('Hey guys welcome back!')
  })

  it('dedups, drops empties, and caps to max', () => {
    expect(pickExemplars(['', '   ', 'One liner here.'])).toEqual(['One liner here.'])
    expect(pickExemplars(['same.', 'same.', 'other.'])).toEqual(['same.', 'other.'])
    expect(pickExemplars(['a sentence one.', 'b sentence two.', 'c sentence three.'], 2)).toHaveLength(2)
  })

  it('caps a very long opener (no sentence punctuation) at ~180 chars', () => {
    const long = 'word '.repeat(100) // 500 chars, no .!?
    expect(pickExemplars([long])[0].length).toBeLessThanOrEqual(180)
  })

  it('returns [] for no usable samples', () => {
    expect(pickExemplars([])).toEqual([])
    expect(pickExemplars(['', '  '])).toEqual([])
  })
})

describe('repurposeHelpers — existing', () => {
  it('prepareScriptCorpus joins, trims, and caps', () => {
    expect(prepareScriptCorpus([' a ', '', 'b'])).toBe('a\n\n---\n\nb')
    expect(prepareScriptCorpus(['x'.repeat(5000)]).length).toBeLessThanOrEqual(4000)
  })

  it('scriptsProfileKey is stable + prefixed', () => {
    expect(scriptsProfileKey(['one', 'two'])).toBe(scriptsProfileKey(['one', 'two']))
    expect(scriptsProfileKey(['one'])).toMatch(/^__scripts__/)
  })
})
