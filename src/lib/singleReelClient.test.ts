import { describe, it, expect } from 'vitest'
import { extractSingleReel } from './singleReelClient'

describe('extractSingleReel', () => {
  it('maps a raw reel-scraper item to ScrapedReel', () => {
    const raw = [{
      shortCode: 'ABC', url: 'https://www.instagram.com/reel/ABC/',
      downloadedVideo: 'https://api.apify.com/v2/key-value-stores/x/records/ABC.mp4',
      caption: 'hi', likesCount: 100, commentsCount: 6, videoViewCount: 5000,
      videoDuration: 22, hashtags: ['a'], ownerUsername: 'garyvee', displayUrl: 'https://x/t.jpg',
      timestamp: '2026-06-01T00:00:00.000Z', musicInfo: { artist_name: 'x' },
    }]
    expect(extractSingleReel(raw)).toEqual({
      shortCode: 'ABC',
      url: 'https://www.instagram.com/reel/ABC/',
      downloadedVideoUrl: 'https://api.apify.com/v2/key-value-stores/x/records/ABC.mp4',
      ownerUsername: 'garyvee',
      caption: 'hi', likesCount: 100, commentsCount: 6, videoViewCount: 5000,
      videoDuration: 22, hashtags: ['a'], displayUrl: 'https://x/t.jpg',
      timestamp: '2026-06-01T00:00:00.000Z', musicInfo: { artist_name: 'x' },
    })
  })
  it('returns null when the item has no downloadable video', () => {
    expect(extractSingleReel([{ shortCode: 'ABC', error: 'blocked' }])).toBeNull()
    expect(extractSingleReel([])).toBeNull()
  })
})
