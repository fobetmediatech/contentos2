import { describe, it, expect } from 'vitest'
import { parseReelUrl, isReelUrl } from './reelUrl'

describe('parseReelUrl', () => {
  it('extracts the shortCode from a /reel/ URL', () => {
    expect(parseReelUrl('https://www.instagram.com/reel/CxYz123_-A/')).toEqual({
      shortCode: 'CxYz123_-A',
      canonicalUrl: 'https://www.instagram.com/reel/CxYz123_-A/',
    })
  })
  it('handles /reels/ and /p/ and query strings and no trailing slash', () => {
    expect(parseReelUrl('https://instagram.com/reels/ABC123?igsh=x')?.shortCode).toBe('ABC123')
    expect(parseReelUrl('http://www.instagram.com/p/ZZ_z9')?.shortCode).toBe('ZZ_z9')
  })
  it('returns null for non-reel URLs', () => {
    expect(parseReelUrl('https://instagram.com/garyvee')).toBeNull()
    expect(parseReelUrl('not a url')).toBeNull()
  })
  it('isReelUrl is a boolean convenience', () => {
    expect(isReelUrl('https://www.instagram.com/reel/abc/')).toBe(true)
    expect(isReelUrl('hello')).toBe(false)
  })
})
