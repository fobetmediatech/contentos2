import { describe, it, expect } from 'vitest'
import { detectSourcePlatform } from './sourceUrl'

describe('detectSourcePlatform', () => {
  it('detects Instagram reel URLs', () => {
    expect(detectSourcePlatform('https://www.instagram.com/reel/CxYz123/')).toBe('instagram')
    expect(detectSourcePlatform('https://instagram.com/p/ABC_def-9/')).toBe('instagram')
  })

  it('detects YouTube Shorts and youtu.be links', () => {
    expect(detectSourcePlatform('https://www.youtube.com/shorts/aB3d_Xyz12')).toBe('youtube')
    expect(detectSourcePlatform('https://youtu.be/aB3d_Xyz12')).toBe('youtube')
    expect(detectSourcePlatform('https://www.youtube.com/watch?v=aB3d_Xyz12')).toBe('youtube')
  })

  it('returns null for anything else', () => {
    expect(detectSourcePlatform('https://tiktok.com/@x/video/123')).toBeNull()
    expect(detectSourcePlatform('not a url')).toBeNull()
    expect(detectSourcePlatform('')).toBeNull()
  })
})
