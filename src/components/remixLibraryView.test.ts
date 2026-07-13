import { describe, it, expect } from 'vitest'
import { filterReels } from './remixLibraryView'
import type { ContentRecord } from '../lib/corpus'

const rec = (over: Partial<ContentRecord>): ContentRecord => ({
  id: 'x', creatorUsername: 'alice', kind: 'reel', caption: 'a caption', transcript: 't',
  url: '', thumbnailUrl: '', videoViewCount: 0, likesCount: 0, commentsCount: 0, hookArchetype: '', analyzedAt: 0,
  ...over,
} as ContentRecord)

describe('filterReels', () => {
  const reels = [
    rec({ id: '1', creatorUsername: 'alice', caption: 'fitness tips', transcript: 'has words' }),
    rec({ id: '2', creatorUsername: 'bob', caption: 'cooking', transcript: '' }),        // no transcript → excluded
    rec({ id: '3', creatorUsername: 'carol', caption: 'money hacks', transcript: 'yes' }),
  ]
  it('drops reels with no transcript', () => {
    expect(filterReels(reels, '').map((r) => r.id)).toEqual(['1', '3'])
  })
  it('matches caption or handle, case-insensitive', () => {
    expect(filterReels(reels, 'CAROL').map((r) => r.id)).toEqual(['3'])
    expect(filterReels(reels, 'fitness').map((r) => r.id)).toEqual(['1'])
  })
})
