import { describe, it, expect } from 'vitest'
import { friendlyApify, friendlyGemini, sparseSeedMessage } from './errorMessages'

describe('friendlyApify / friendlyGemini', () => {
  it('maps known codes and falls back for unknown ones', () => {
    expect(friendlyApify('QUOTA_EXCEEDED')).toMatch(/monthly usage limit/i)
    expect(friendlyApify('SOMETHING_NEW')).toMatch(/try again/i)
    expect(friendlyGemini('AUTH_ERROR')).toMatch(/key is invalid/i)
    expect(friendlyGemini('SOMETHING_NEW')).toMatch(/AI analysis failed/i)
  })
})

describe('sparseSeedMessage', () => {
  it('says "couldn\'t find" when the reference handle was not found at all', () => {
    const msg = sparseSeedMessage(['nike.training'], false)
    expect(msg).toContain('@nike.training')
    expect(msg).toMatch(/couldn't find/i)
    expect(msg).toMatch(/private, renamed, or misspelled/i)
  })

  it('says "no related accounts" when the handle was found but has nothing adjacent', () => {
    const msg = sparseSeedMessage(['someone'], true)
    expect(msg).toContain('@someone')
    expect(msg).toMatch(/no related public accounts/i)
    expect(msg).toMatch(/more established reference account/i)
  })

  it('normalizes a leading @ and pluralizes the verb for multiple handles', () => {
    expect(sparseSeedMessage(['@alice'], true)).toContain('@alice') // single @ stripped, not doubled
    expect(sparseSeedMessage(['@alice'], true)).not.toContain('@@')
    const multi = sparseSeedMessage(['alice', 'bob'], true)
    expect(multi).toContain('@alice, @bob')
    expect(multi).toMatch(/@alice, @bob have no related/) // plural "have"
  })

  it('falls back to a generic subject when no handles are given', () => {
    expect(sparseSeedMessage([], false)).toContain('that account')
  })
})
