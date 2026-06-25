// src/hooks/repurposeHelpers.test.ts
import { describe, it, expect } from 'vitest'
import { prepareScriptCorpus, scriptsProfileKey } from '../lib/repurposeHelpers'

describe('repurposeHelpers', () => {
  it('prepareScriptCorpus trims, drops empties, and caps total length at 4000 chars', () => {
    const out = prepareScriptCorpus(['  hi  ', '', 'x'.repeat(5000)])
    expect(out).toContain('hi')
    expect(out.length).toBeLessThanOrEqual(4000)
  })

  it('scriptsProfileKey is stable for the same scripts and prefixed', () => {
    const a = scriptsProfileKey(['one', 'two'])
    const b = scriptsProfileKey(['one', 'two'])
    expect(a).toBe(b)
    expect(a.startsWith('__scripts__')).toBe(true)
  })
})
