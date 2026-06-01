import { describe, it, expect } from 'vitest'
import { filterAndSortReels } from './reelScraper'

// Minimal raw post factory — matches the shape reelScraper expects
function makeRawPost(overrides: Record<string, unknown> = {}) {
  return {
    shortCode: 'abc123',
    url: 'https://instagram.com/p/abc123',
    displayUrl: 'https://cdn.example.com/thumb.jpg',
    videoViewCount: 10000,
    likesCount: 500,
    commentsCount: 20,
    videoDuration: 30,
    caption: 'A test reel #test',
    hashtags: ['test'],
    productType: 'clips',
    ...overrides,
  }
}

describe('filterAndSortReels', () => {
  it('returns empty array when no posts pass the filter', () => {
    const posts = [
      makeRawPost({ productType: 'image' }),
      makeRawPost({ productType: 'carousel_container' }),
    ]
    expect(filterAndSortReels(posts, 5)).toEqual([])
  })

  it('filters out posts where productType !== "clips"', () => {
    const posts = [
      makeRawPost({ shortCode: 'reel1', productType: 'clips', videoViewCount: 5000 }),
      makeRawPost({ shortCode: 'photo1', productType: 'image', videoViewCount: 9000 }),
      makeRawPost({ shortCode: 'carousel1', productType: 'carousel_container', videoViewCount: 8000 }),
    ]
    const result = filterAndSortReels(posts, 10)
    expect(result).toHaveLength(1)
    expect(result[0].shortCode).toBe('reel1')
  })

  it('filters out posts where videoViewCount === 0', () => {
    const posts = [
      makeRawPost({ shortCode: 'zeroViews', productType: 'clips', videoViewCount: 0 }),
      makeRawPost({ shortCode: 'hasViews', productType: 'clips', videoViewCount: 100 }),
    ]
    const result = filterAndSortReels(posts, 10)
    expect(result).toHaveLength(1)
    expect(result[0].shortCode).toBe('hasViews')
  })

  it('filter uses AND — post with clips but 0 views is excluded', () => {
    const posts = [
      // clips but 0 views — should be excluded (both conditions must be true)
      makeRawPost({ shortCode: 'clipsZero', productType: 'clips', videoViewCount: 0 }),
      // not clips but has views — should also be excluded
      makeRawPost({ shortCode: 'imageViews', productType: 'image', videoViewCount: 50000 }),
      // clips + views — only this passes
      makeRawPost({ shortCode: 'good', productType: 'clips', videoViewCount: 2000 }),
    ]
    const result = filterAndSortReels(posts, 10)
    expect(result).toHaveLength(1)
    expect(result[0].shortCode).toBe('good')
  })

  it('sorts by videoViewCount descending', () => {
    const posts = [
      makeRawPost({ shortCode: 'low', productType: 'clips', videoViewCount: 1000 }),
      makeRawPost({ shortCode: 'high', productType: 'clips', videoViewCount: 50000 }),
      makeRawPost({ shortCode: 'mid', productType: 'clips', videoViewCount: 10000 }),
    ]
    const result = filterAndSortReels(posts, 10)
    expect(result[0].shortCode).toBe('high')
    expect(result[1].shortCode).toBe('mid')
    expect(result[2].shortCode).toBe('low')
  })

  it('returns Math.min(n, results.length) items — n=3 on 5 reels gives 3', () => {
    const posts = Array.from({ length: 5 }, (_, i) =>
      makeRawPost({ shortCode: `reel${i}`, productType: 'clips', videoViewCount: (i + 1) * 1000 })
    )
    const result = filterAndSortReels(posts, 3)
    expect(result).toHaveLength(3)
  })

  it('returns Math.min(n, results.length) items — n=10 on 3 reels gives 3', () => {
    const posts = [
      makeRawPost({ shortCode: 'r1', productType: 'clips', videoViewCount: 1000 }),
      makeRawPost({ shortCode: 'r2', productType: 'clips', videoViewCount: 2000 }),
      makeRawPost({ shortCode: 'r3', productType: 'clips', videoViewCount: 3000 }),
    ]
    const result = filterAndSortReels(posts, 10)
    expect(result).toHaveLength(3)
  })

  it('maps all ReelData fields correctly', () => {
    const raw = makeRawPost({
      shortCode: 'xyz999',
      url: 'https://instagram.com/p/xyz999',
      displayUrl: 'https://cdn.example.com/xyz999.jpg',
      videoViewCount: 75000,
      likesCount: 1200,
      commentsCount: 88,
      videoDuration: 45,
      caption: 'Best reel ever #viral',
      hashtags: ['viral', 'reels'],
      productType: 'clips',
    })
    const result = filterAndSortReels([raw], 1)
    expect(result).toHaveLength(1)
    const reel = result[0]
    expect(reel.shortCode).toBe('xyz999')
    expect(reel.url).toBe('https://instagram.com/p/xyz999')
    expect(reel.displayUrl).toBe('https://cdn.example.com/xyz999.jpg')
    expect(reel.videoViewCount).toBe(75000)
    expect(reel.likesCount).toBe(1200)
    expect(reel.commentsCount).toBe(88)
    expect(reel.videoDuration).toBe(45)
    expect(reel.caption).toBe('Best reel ever #viral')
    expect(reel.hashtags).toEqual(['viral', 'reels'])
  })

  it('handles undefined/null caption and hashtags gracefully', () => {
    const raw = makeRawPost({ caption: null, hashtags: undefined, videoViewCount: 1000 })
    const result = filterAndSortReels([raw], 1)
    expect(result[0].caption).toBe('')
    expect(result[0].hashtags).toEqual([])
  })
})
