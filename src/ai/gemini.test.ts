import { describe, it, expect, vi } from 'vitest'
import { resolvePremiumModel } from './gemini'

describe('resolvePremiumModel', () => {
  it('uses a valid gemini-* override', () => {
    expect(resolvePremiumModel('gemini-2.5-pro', 'gemini-2.5-flash')).toBe('gemini-2.5-pro')
  })

  it('falls back to the default when unset or empty', () => {
    expect(resolvePremiumModel(undefined, 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
    expect(resolvePremiumModel('', 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('falls back (and warns) on a non-model value — and never echoes it (it may be a secret)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const strayKey = 'AQ.Ab8_pretend_secret_api_key'
    expect(resolvePremiumModel(strayKey, 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
    expect(resolvePremiumModel('gpt-4', 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
    expect(warn).toHaveBeenCalled()
    // The offending value must never be logged — that would re-leak a mispasted key.
    expect(warn.mock.calls.flat().join(' ')).not.toContain(strayKey)
    warn.mockRestore()
  })
})
