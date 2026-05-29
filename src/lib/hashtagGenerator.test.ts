import { describe, it, expect } from 'vitest'
import { sanitize, ruleFallback } from './hashtagGenerator'

describe('sanitize', () => {
  it('strips newlines', () => {
    expect(sanitize('foo\nbar', 50)).toBe('foo bar')
    expect(sanitize('foo\r\nbar', 50)).toBe('foo  bar')
  })

  it('removes disallowed characters', () => {
    expect(sanitize('hello!@#$world', 50)).toBe('helloworld')
  })

  it('allows word chars, spaces, commas, hyphens', () => {
    expect(sanitize('New Delhi, street-food', 50)).toBe('New Delhi, street-food')
  })

  it('trims whitespace', () => {
    expect(sanitize('  Indore  ', 50)).toBe('Indore')
  })

  it('clamps to maxLen', () => {
    expect(sanitize('a'.repeat(60), 50)).toHaveLength(50)
  })

  it('returns empty string when all chars stripped', () => {
    expect(sanitize('!@#$%', 50)).toBe('')
  })
})

describe('ruleFallback', () => {
  it('returns the requested count', () => {
    expect(ruleFallback('Indore', 'food', 5)).toHaveLength(5)
  })

  it('returns up to 8 for deep mode', () => {
    expect(ruleFallback('Indore', 'food', 8)).toHaveLength(8)
  })

  it('includes creator self-ID hashtags (Vlogger + Blogger) in the first 3 positions', () => {
    // niche is passed as-is; 'food' stays lowercase in the generated tag
    const tags = ruleFallback('Indore', 'food', 5)
    expect(tags[0]).toBe('Indorefood')
    expect(tags[1]).toBe('IndorefoodVlogger')
    expect(tags[2]).toBe('IndorefoodBlogger')
  })

  it('deduplicates case-insensitively', () => {
    const tags = ruleFallback('Indore', 'Food', 11)
    const lower = tags.map((t) => t.toLowerCase())
    expect(new Set(lower).size).toBe(tags.length)
  })

  it('handles multi-word city by stripping spaces in hashtag', () => {
    const tags = ruleFallback('New Delhi', 'food', 3)
    expect(tags[0]).toBe('NewDelhifood')
    expect(tags[1]).toBe('NewDelhifoodVlogger')
  })

  it('handles multi-word niche by stripping spaces in hashtag', () => {
    const tags = ruleFallback('Mumbai', 'street food', 3)
    expect(tags[0]).toBe('Mumbaistreetfood')
    expect(tags[1]).toBe('MumbaistreetfoodVlogger')
  })

  it('never returns more than requested even if candidates > count', () => {
    const tags = ruleFallback('Indore', 'food', 3)
    expect(tags).toHaveLength(3)
  })
})
