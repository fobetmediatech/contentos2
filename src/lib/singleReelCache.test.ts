import { describe, it, expect } from 'vitest'
import { getCachedSingleReel, setCachedSingleReel } from './singleReelCache'
import type { SingleReelResult } from '../domain/reel'

const sample: SingleReelResult = { transcript: 't', segments: [], videoAnalysis: {} as never, markdown: '# hi' }

describe('singleReelCache', () => {
  it('degrades to a no-op (undefined) when IndexedDB is absent (Node)', async () => {
    await setCachedSingleReel('ABC', sample)
    expect(await getCachedSingleReel('ABC')).toBeUndefined()
  })
})
