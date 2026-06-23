import { describe, it, expect } from 'vitest'
import { getShownProfiles, addShownProfiles } from './competitorCache'

// IndexedDB is not available in the Node/Vitest environment.
// Both functions must degrade silently — same pattern as singleReelCache.test.ts.

describe('competitorCache (IDB unavailable — Node)', () => {
  it('getShownProfiles returns an empty map when IndexedDB is absent', async () => {
    const result = await getShownProfiles('conv-1', ['@nike', '@adidas'])
    expect(result).toEqual({})
  })

  it('addShownProfiles is a no-op when IndexedDB is absent', async () => {
    await expect(
      addShownProfiles('conv-1', ['@nike'], [
        { username: 'a', category: 'top' },
        { username: 'b', category: 'trending' },
      ]),
    ).resolves.toBeUndefined()
  })
})
