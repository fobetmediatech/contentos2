import { describe, it, expect } from 'vitest'
import { fieldKey, fieldLabel, applyFieldValue } from './remixFields'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

const R: ReelRewriteResult = {
  spokenHook: 'hook', caption: 'cap', cta: 'cta',
  beatScript: [{ beatLabel: 'B1', script: 's1', onScreenText: 'o1' }, { beatLabel: 'B2', script: 's2', onScreenText: 'o2' }],
  onScreenText: ['x', 'y'], altHooks: ['a', 'b', 'c'],
}

describe('fieldKey', () => {
  it('gives stable keys incl. indices', () => {
    expect(fieldKey({ kind: 'hook' })).toBe('hook')
    expect(fieldKey({ kind: 'beatScript', i: 1 })).toBe('beatScript:1')
    expect(fieldKey({ kind: 'onScreen', j: 0 })).toBe('onScreen:0')
  })
})

describe('fieldLabel', () => {
  it('is human + 1-indexed', () => {
    expect(fieldLabel({ kind: 'beatScript', i: 0 })).toContain('beat 1')
    expect(fieldLabel({ kind: 'hook' })).toContain('hook')
  })
})

describe('applyFieldValue (immutable)', () => {
  it('replaces the targeted slot only', () => {
    expect(applyFieldValue(R, { kind: 'hook' }, 'NEW').spokenHook).toBe('NEW')
    expect(applyFieldValue(R, { kind: 'beatScript', i: 1 }, 'NEW').beatScript[1].script).toBe('NEW')
    expect(applyFieldValue(R, { kind: 'beatOverlay', i: 0 }, 'NEW').beatScript[0].onScreenText).toBe('NEW')
    expect(applyFieldValue(R, { kind: 'onScreen', j: 1 }, 'NEW').onScreenText[1]).toBe('NEW')
    // original untouched
    expect(R.spokenHook).toBe('hook')
  })
})
