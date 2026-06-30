// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useThemeStore, resolveScheme } from './themeStore'

// NB: this env's localStorage methods aren't real functions (see persistStorage.ts), so the
// store's persistence is a guarded no-op here — we assert in-memory state + the <html> attribute.
describe('themeStore', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('resolveScheme maps explicit preferences straight through', () => {
    expect(resolveScheme('light')).toBe('light')
    expect(resolveScheme('dark')).toBe('dark')
  })

  it('setPref updates state and applies data-theme on <html>', () => {
    useThemeStore.getState().setPref('light')
    expect(useThemeStore.getState().pref).toBe('light')
    expect(useThemeStore.getState().resolved).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    useThemeStore.getState().setPref('dark')
    expect(useThemeStore.getState().resolved).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('toggle flips the effective scheme and pins it as an explicit choice', () => {
    useThemeStore.getState().setPref('dark')
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().resolved).toBe('light')
    expect(useThemeStore.getState().pref).toBe('light')

    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().resolved).toBe('dark')
    expect(useThemeStore.getState().pref).toBe('dark')
  })
})
