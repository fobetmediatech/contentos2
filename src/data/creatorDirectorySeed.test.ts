import { describe, it, expect } from 'vitest'
import { DIRECTORY_SEED } from './creatorDirectorySeed'
import { directoryId } from '../lib/creatorDirectory'

describe('DIRECTORY_SEED', () => {
  it('every entry has a matching stable id and no @ in handle', () => {
    for (const e of DIRECTORY_SEED) {
      expect(e.id).toBe(directoryId(e.category, e.handle))
      expect(e.handle.startsWith('@')).toBe(false)
      expect(e.displayName.length).toBeGreaterThan(0)
    }
  })
  it('has no duplicate ids', () => {
    const ids = DIRECTORY_SEED.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('covers several categories', () => {
    expect(new Set(DIRECTORY_SEED.map((e) => e.category)).size).toBeGreaterThanOrEqual(5)
  })
})
