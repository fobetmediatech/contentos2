import { describe, it, expect } from 'vitest'
import { matchesKonami, normalizeKey, KONAMI_SEQUENCE } from './konami'

describe('normalizeKey', () => {
  it('lowercases single-character keys (so B/A match b/a)', () => {
    expect(normalizeKey('B')).toBe('b')
    expect(normalizeKey('A')).toBe('a')
  })
  it('leaves named keys untouched', () => {
    expect(normalizeKey('ArrowUp')).toBe('ArrowUp')
  })
})

describe('matchesKonami', () => {
  it('matches the exact sequence', () => {
    expect(matchesKonami([...KONAMI_SEQUENCE])).toBe(true)
  })
  it('matches when the sequence is the suffix of a longer buffer', () => {
    expect(matchesKonami(['x', 'y', 'z', ...KONAMI_SEQUENCE])).toBe(true)
  })
  it('does not match an incomplete buffer', () => {
    expect(matchesKonami(KONAMI_SEQUENCE.slice(0, 5) as unknown as string[])).toBe(false)
  })
  it('does not match a wrong final key', () => {
    const wrong: string[] = [...KONAMI_SEQUENCE]
    wrong[wrong.length - 1] = 'x'
    expect(matchesKonami(wrong)).toBe(false)
  })
  it('matches uppercase B/A once normalized', () => {
    const typed = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'B', 'A']
    expect(matchesKonami(typed.map(normalizeKey))).toBe(true)
  })
})
